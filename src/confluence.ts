import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
// Import FormData dynamically to make testing easier
// This will be mocked in tests
import type { default as FormDataType } from 'form-data';

// Get FormData implementation - will be replaced by mocks in tests
const FormData: typeof FormDataType = require('form-data');

// Define ADFEntity type since we can't import it
export interface ADFEntity {
  type: string;
  content?: ADFEntity[];
  [key: string]: unknown;
}

export interface ConfluenceResponse {
  id: string;
  type: string;
  status: string;
  title: string;
  version?: {
    number: number;
  };
  links: {
    webui: string;
  };
  parentId?: string;
  space?: {
    key: string;
    id?: string;
    name?: string;
  };
  ancestors?: Array<{ id: string }>;
}

export interface ConfluenceSearchResponse {
  results: ConfluenceResponse[];
}

export interface ImageUploadResponse {
  id: string;
  type: string;
  status: string;
  title: string;
  mediaType: string;
  fileSize: number;
  downloadUrl: string;
}

// Add interface for space information
export interface ConfluenceSpace {
  id: string;
  key: string;
  name: string;
  type: string;
  status: string;
  homepage?: { id: string };
  homepageId?: string;
}

export interface ConfluenceSpaceResponse {
  results: ConfluenceSpace[];
}

/**
 * Type of Confluence instance: Cloud or Server/Data Center
 */
export type ConfluenceInstanceType = 'cloud' | 'server';

/**
 * Content format types for Confluence pages
 */
export type PageContent =
  | { format: 'adf'; data: ADFEntity }
  | { format: 'wiki'; data: string }
  | { format: 'storage'; data: string };

/**
 * Options for creating or updating a Confluence page
 */
export interface CreateOrUpdatePageOptions {
  spaceKey: string;
  title: string;
  content: PageContent;
  parentId?: string;
  pageId?: string;
  labels?: string[];
}

interface ExtensionAttrs {
  extensionType?: string;
  extensionKey?: string;
  parameters?: Record<string, unknown>;
}

export class ConfluenceClient {
  private baseUrl: string;
  private email: string;
  private apiToken: string;
  private personalAccessToken: string | null;
  private debug: boolean;
  private authType: 'basic' | 'pat';
  private instanceType: ConfluenceInstanceType;
  // Per-run cache of uploaded attachments, keyed by `${scope}:${filename}:${sha256}`.
  // Prevents re-uploading the same image multiple times within a single run.
  private uploadCache = new Map<string, ImageUploadResponse>();

  constructor(
    baseUrl: string,
    auth: {
      // Either provide email + apiToken for Basic auth
      email?: string;
      apiToken?: string;
      // Or provide a personal access token for PAT auth
      personalAccessToken?: string;
    },
    debug = false,
    instanceType: ConfluenceInstanceType = 'cloud'
  ) {
    // Remove trailing slashes to avoid path issues
    this.baseUrl = baseUrl.replace(/\/+$/, '');

    // Normalize baseUrl - make sure we don't have duplicate paths in it
    // If the URL ends with /rest, save it exactly as is
    if (this.baseUrl.endsWith('/rest')) {
      // Already correctly formatted
    }
    // For Server/Data Center with default context path
    else if (this.baseUrl.includes('/confluence') && !this.baseUrl.endsWith('/rest')) {
      // For consistency, don't add /rest here - we'll add it in buildApiEndpoint
    }
    // For Cloud instances
    else if (instanceType === 'cloud' && !this.baseUrl.endsWith('/wiki')) {
      this.baseUrl = `${this.baseUrl}/wiki`;
    }

    this.instanceType = instanceType;

    // Determine auth type and validate required fields
    if (auth.personalAccessToken) {
      this.authType = 'pat';
      this.personalAccessToken = auth.personalAccessToken;
      this.email = '';
      this.apiToken = '';
    } else if (auth.email && auth.apiToken) {
      this.authType = 'basic';
      this.email = auth.email;
      this.apiToken = auth.apiToken;
      this.personalAccessToken = null;
    } else {
      throw new Error('Authentication requires either email+apiToken or personalAccessToken');
    }

    this.debug = debug;

    if (this.debug) {
      console.log(`Using baseUrl: ${this.baseUrl}`);
      console.log(`Using instance type: ${this.instanceType}`);
    }
  }

  // DRY method for auth headers
  private getAuthHeaders(additionalHeaders = {}): Record<string, string> {
    let authHeader: string;

    if (this.authType === 'pat') {
      authHeader = `Bearer ${this.personalAccessToken}`;
    } else {
      // Basic auth with email and API token
      authHeader = `Basic ${Buffer.from(`${this.email}:${this.apiToken}`).toString('base64')}`;
    }

    return {
      Authorization: authHeader,
      Accept: 'application/json',
      ...additionalHeaders,
    };
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log(...args);
    }
  }

  // Small delay helper for backoff. Skips real waiting in tests (fetch is mocked).
  private sleep(ms: number): Promise<void> {
    if (process.env.NODE_ENV === 'test' || ms <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Parse a Retry-After header (delta-seconds) into milliseconds, if present.
  private parseRetryAfter(response: Response): number | null {
    const header = response.headers?.get?.('retry-after');
    if (!header) {
      return null;
    }
    const seconds = Number(header);
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000);
    }
    // Retry-After can also be an HTTP date.
    const dateMs = Date.parse(header);
    if (!Number.isNaN(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }
    return null;
  }

  private async _fetchJson(url: string, fetchOptions: RequestInit = {}): Promise<unknown> {
    // Ensure headers from getAuthHeaders are merged with any provided in fetchOptions
    const headers = {
      ...this.getAuthHeaders(),
      ...(fetchOptions.headers || {}),
    };

    this.log(`Fetching: ${url}`);
    if (this.debug && Object.keys(fetchOptions).length > 0) {
      // Clone options for logging to avoid logging body if it's a stream
      const loggableOptions = { ...fetchOptions };
      if (loggableOptions.body && typeof loggableOptions.body !== 'string') {
        loggableOptions.body = '[Stream or non-string body]';
      }
      this.log(`With options: ${JSON.stringify(loggableOptions, null, 2)}`);
    }

    // Retry on rate limiting (429) and transient unavailability (503).
    // Honor Retry-After when provided, otherwise back off exponentially: 2s, 4s, 8s.
    const maxAttempts = 4;
    let response: Response = null as unknown as Response;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      response = await fetch(url, {
        ...fetchOptions, // Spread options first
        headers, // Then override headers
      });

      if (response.status !== 429 && response.status !== 503) {
        break;
      }
      if (attempt === maxAttempts) {
        break; // Out of retries; fall through to the error handling below.
      }

      const retryAfterMs = this.parseRetryAfter(response);
      const backoffMs = retryAfterMs ?? 2 ** attempt * 1000;
      this.log(
        `Rate limited (${response.status}) on ${url}. Retry ${attempt}/${maxAttempts - 1} in ${backoffMs}ms.`
      );
      await this.sleep(backoffMs);
    }

    if (!response.ok) {
      const errorText = await response.text();
      let errorData: unknown;
      try {
        errorData = JSON.parse(errorText);
      } catch (_e) {
        errorData = { message: errorText };
      }

      const errorMessage =
        typeof errorData === 'object' && errorData && 'message' in errorData
          ? (errorData as { message?: string }).message
          : response.statusText;

      const error = new Error(`API request failed: ${response.status} ${errorMessage}`);

      if (this.debug) {
        console.error('Response status:', response.status);
        console.error('Response text:', errorText);
        console.error('Request URL:', url);
        console.error('Request options:', fetchOptions);
      }
      throw error;
    }
    return response.json();
  }

  // Helper to build the API endpoint properly based on baseUrl and instance type
  private buildApiEndpoint(path: string): string {
    // Important: Don't add '/wiki' if it's already in the baseUrl
    // The baseUrl from config should already include it
    const apiPath = path.startsWith('/') ? path : `/${path}`;

    // Detect if baseUrl already ends with /rest to avoid duplication
    const baseEndsWithRest = this.baseUrl.endsWith('/rest');

    // Use helper to determine instance type
    const effectiveInstanceType = this.getEffectiveInstanceType();

    // For Server/Data Center, use different API paths
    if (effectiveInstanceType === 'server') {
      // Server/Data Center uses different API endpoints
      // If path already starts with /rest/, use it as-is
      if (path.startsWith('/rest/')) {
        return `${this.baseUrl}${path.startsWith('/') && baseEndsWithRest ? path.substring(1) : path}`;
      }

      // Otherwise, convert Cloud paths to Server/Data Center paths
      // Avoid duplication of /rest
      if (baseEndsWithRest) {
        return `${this.baseUrl}/api${apiPath}`;
      }
      return `${this.baseUrl}/rest/api${apiPath}`;
    }

    // For Cloud, use the existing API paths
    return `${this.baseUrl}${apiPath}`;
  }

  // Helper to determine the effective instance type based on URL
  private getEffectiveInstanceType(): ConfluenceInstanceType {
    // If URL contains /confluence, assume it's a server installation
    return this.baseUrl.includes('/confluence') ? 'server' : this.instanceType;
  }

  private async _getSpaceByKeyServer(spaceKey: string): Promise<ConfluenceSpace | null> {
    const endpoint = this.buildApiEndpoint('/space');
    const params = new URLSearchParams({ spaceKey: spaceKey });
    const url = `${endpoint}?${params}`;
    this.log(`Fetching server space information for key ${spaceKey} at: ${url}`);
    const result = (await this._fetchJson(url)) as ConfluenceSpaceResponse;
    // Server API for /space?spaceKey=X returns a list
    return result.results?.[0] || null;
  }

  private async _getSpaceByKeyCloud(spaceKey: string): Promise<ConfluenceSpace | null> {
    const endpoint = this.buildApiEndpoint('/api/v2/spaces');
    const params = new URLSearchParams({ key: spaceKey, status: 'current', limit: '1' });
    const url = `${endpoint}?${params}`;
    this.log(`Fetching cloud space information for key ${spaceKey} at: ${url}`);
    const result = await this._fetchJson(url);
    return (result as ConfluenceSpaceResponse).results[0] || null;
  }

  // Add method to get space by key
  async getSpaceByKey(spaceKey: string): Promise<ConfluenceSpace | null> {
    const effectiveInstanceType = this.getEffectiveInstanceType();
    if (effectiveInstanceType === 'server') {
      return this._getSpaceByKeyServer(spaceKey);
    }
    return this._getSpaceByKeyCloud(spaceKey);
  }

  private async _createPageServer(
    spaceKey: string,
    title: string,
    content: ADFEntity,
    parentId?: string
  ): Promise<ConfluenceResponse> {
    const endpoint = this.buildApiEndpoint('/content');
    const body: Record<string, unknown> = {
      type: 'page',
      title,
      space: { key: spaceKey },
    };

    if (this.isWikiMarkupADF(content)) {
      body.body = {
        wiki: {
          value: this.extractWikiMarkupContent(content),
          representation: 'wiki',
        },
      };
    } else {
      body.body = {
        storage: {
          value: this.convertADFToStorage(content),
          representation: 'storage',
        },
      };
    }

    if (parentId) {
      body.ancestors = [{ id: parentId }];
    }
    this.log(`Creating server page at: ${endpoint}`);
    this.log(`Request body: ${JSON.stringify(body, null, 2)}`);
    return this._fetchJson(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as Promise<ConfluenceResponse>;
  }

  private async _createPageCloud(
    spaceKey: string,
    title: string,
    content: ADFEntity,
    parentId?: string
  ): Promise<ConfluenceResponse> {
    const endpoint = this.buildApiEndpoint('/api/v2/pages');
    const space = await this.getSpaceByKey(spaceKey);
    if (!space) {
      throw new Error(`Space with key "${spaceKey}" not found for Cloud page creation.`);
    }
    let bodyValue: string;
    let representation: string;
    if (this.isWikiMarkupADF(content)) {
      bodyValue = this.extractWikiMarkupContent(content);
      representation = 'wiki';
      this.log('Using wiki format for wiki markup');
    } else if (this.isMarkdownMacroADF(content)) {
      // Extract markdown content and create the macro in storage format
      bodyValue = this.createMarkdownMacroStorage(this.extractMarkdownContent(content));
      representation = 'storage';
      this.log('Using storage format for Markdown macro');
    } else {
      // Normal ADF handling
      bodyValue = JSON.stringify(content);
      representation = 'atlas_doc_format';
    }

    const body: Record<string, unknown> = {
      spaceId: space.id,
      status: 'current',
      title,
      body: {
        representation,
        value: bodyValue,
      },
    };

    if (parentId) {
      body.parentId = parentId;
    }
    this.log(`Creating cloud page at: ${endpoint}`);
    this.log(`Request body: ${JSON.stringify(body, null, 2)}`);
    return this._fetchJson(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as Promise<ConfluenceResponse>;
  }

  // Update createPage to use spaceId
  async createPage(
    spaceKey: string,
    title: string,
    content: ADFEntity,
    parentId?: string
  ): Promise<ConfluenceResponse> {
    const effectiveInstanceType = this.getEffectiveInstanceType();
    if (effectiveInstanceType === 'server') {
      return this._createPageServer(spaceKey, title, content, parentId);
    }
    return this._createPageCloud(spaceKey, title, content, parentId);
  }

  private async _updatePageServer(
    pageId: string,
    title: string,
    content: ADFEntity,
    version: number
  ): Promise<ConfluenceResponse> {
    const endpoint = this.buildApiEndpoint(`/content/${pageId}`);
    const currentPage = await this.getPage(pageId); // getPage is now refactored
    const body: Record<string, unknown> = {
      id: pageId,
      type: 'page',
      title,
      space: { key: currentPage.space?.key },
      version: { number: version },
    };

    if (this.isWikiMarkupADF(content)) {
      body.body = {
        wiki: {
          value: this.extractWikiMarkupContent(content),
          representation: 'wiki',
        },
      };
    } else {
      body.body = {
        storage: {
          value: this.convertADFToStorage(content),
          representation: 'storage',
        },
      };
    }
    this.log(`Updating server page at: ${endpoint}`);
    this.log(`Request body: ${JSON.stringify(body, null, 2)}`);
    return this._fetchJson(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as Promise<ConfluenceResponse>;
  }

  private async _updatePageCloud(
    pageId: string,
    title: string,
    content: ADFEntity,
    version: number
  ): Promise<ConfluenceResponse> {
    const endpoint = this.buildApiEndpoint(`/api/v2/pages/${pageId}`);

    // For Markdown macro, always use storage format
    let bodyValue: string;
    let representation: string;

    if (this.isWikiMarkupADF(content)) {
      bodyValue = this.extractWikiMarkupContent(content);
      representation = 'wiki';
      this.log('Using wiki format for wiki markup');
    } else if (this.isMarkdownMacroADF(content)) {
      // Extract markdown content and create the macro in storage format
      bodyValue = this.createMarkdownMacroStorage(this.extractMarkdownContent(content));
      representation = 'storage';
      this.log('Using storage format for Markdown macro');
    } else {
      // Normal ADF handling
      bodyValue = JSON.stringify(content);
      representation = 'atlas_doc_format';
    }

    const body: Record<string, unknown> = {
      id: pageId,
      status: 'current',
      title,
      body: {
        representation,
        value: bodyValue,
      },
      version: {
        number: version,
        message: `Updated via doc2confluence (version ${version})`,
      },
    };
    this.log(`Updating cloud page at: ${endpoint}`);
    this.log(`Request body: ${JSON.stringify(body, null, 2)}`);
    return this._fetchJson(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as Promise<ConfluenceResponse>;
  }

  async updatePage(
    pageId: string,
    title: string,
    content: ADFEntity,
    version: number
  ): Promise<ConfluenceResponse> {
    const effectiveInstanceType = this.getEffectiveInstanceType();
    if (effectiveInstanceType === 'server') {
      return this._updatePageServer(pageId, title, content, version);
    }
    return this._updatePageCloud(pageId, title, content, version);
  }

  private async _getPageServer(pageId: string): Promise<ConfluenceResponse> {
    const endpoint = this.buildApiEndpoint(`/content/${pageId}?expand=space,version,body.storage`);
    this.log(`Getting server page from: ${endpoint}`);
    return this._fetchJson(endpoint) as Promise<ConfluenceResponse>;
  }

  private async _getPageCloud(pageId: string): Promise<ConfluenceResponse> {
    const endpoint = this.buildApiEndpoint(`/api/v2/pages/${pageId}`);
    this.log(`Getting cloud page from: ${endpoint}`);
    return this._fetchJson(endpoint) as Promise<ConfluenceResponse>;
  }

  async getPage(pageId: string): Promise<ConfluenceResponse> {
    const effectiveInstanceType = this.getEffectiveInstanceType();
    if (effectiveInstanceType === 'server') {
      return this._getPageServer(pageId);
    }
    return this._getPageCloud(pageId);
  }

  // Helper to check if a page matches a parentId, considering instance type
  private _doesPageMatchParent(
    page: ConfluenceResponse,
    parentId: string,
    instanceType: ConfluenceInstanceType
  ): boolean {
    if (instanceType === 'server') {
      return page.ancestors?.some((ancestor) => ancestor.id === parentId) || false;
    }
    return page.parentId === parentId;
  }

  private async _getPageByTitleServer(
    spaceKey: string,
    title: string,
    parentId?: string
  ): Promise<ConfluenceResponse | null> {
    const endpoint = this.buildApiEndpoint('/content');
    const params = new URLSearchParams({
      title,
      spaceKey,
      expand: 'version,space,body.storage,ancestors', // Ensure ancestors is expanded for server
      status: 'current',
    });
    this.log(`Searching for server page at: ${endpoint}?${params}`);
    const data = (await this._fetchJson(`${endpoint}?${params}`)) as ConfluenceSearchResponse;
    const results: ConfluenceResponse[] = data.results || [];

    if (!results || results.length === 0) return null;
    if (!parentId) return results[0];

    // Server needs to check ancestors from the already expanded data
    const pageWithParent = results.find((page) =>
      this._doesPageMatchParent(page, parentId, 'server')
    );
    if (pageWithParent) return pageWithParent;

    // Fallback warning logic (if needed, or simplify if direct check is enough)
    this.log(
      `WARNING: Found server pages with title "${title}" but none with parentId "${parentId}" in initial expanded data.`
    );
    return results[0];
  }

  private async _getPageByTitleCloud(
    spaceKey: string,
    title: string,
    parentId?: string
  ): Promise<ConfluenceResponse | null> {
    const space = await this.getSpaceByKey(spaceKey);
    if (!space) {
      throw new Error(`Space with key "${spaceKey}" not found for Cloud page search.`);
    }
    this.log(`Found space for Cloud page search: ${space.name} (ID: ${space.id})`);

    const endpoint = this.buildApiEndpoint('/api/v2/pages');
    const params = new URLSearchParams({
      title,
      status: 'current',
      limit: '100',
      spaceId: space.id,
    });
    this.log(`Searching for cloud page at: ${endpoint}?${params}`);
    const data = (await this._fetchJson(`${endpoint}?${params}`)) as ConfluenceSearchResponse;
    const results: ConfluenceResponse[] = data.results || [];

    if (!results || results.length === 0) return null;
    if (!parentId) return results[0];

    // Cloud might need to fetch full page details if parentId isn't in search results
    // For now, assuming direct parentId check on results is sufficient, or that getPage includes it if called
    const pageWithParent = results.find((page) =>
      this._doesPageMatchParent(page, parentId, 'cloud')
    );
    if (pageWithParent) return pageWithParent;

    // If not found directly, iterate and fetch full details (original logic)
    for (const page of results) {
      try {
        const pageDetails = await this.getPage(page.id); // getPage is refactored
        if (this._doesPageMatchParent(pageDetails, parentId, 'cloud')) {
          this.log(`Found cloud page with matching parentId after full fetch: ${pageDetails.id}`);
          return pageDetails;
        }
      } catch (error) {
        this.log(
          `Error getting details for cloud page ${page.id}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    this.log(
      `WARNING: Found cloud pages with title "${title}" but none with parentId "${parentId}".`
    );
    return results[0];
  }

  async getPageByTitle(
    spaceKey: string,
    title: string,
    parentId?: string
  ): Promise<ConfluenceResponse | null> {
    const effectiveInstanceType = this.getEffectiveInstanceType();
    if (effectiveInstanceType === 'server') {
      return this._getPageByTitleServer(spaceKey, title, parentId);
    }
    return this._getPageByTitleCloud(spaceKey, title, parentId);
  }

  /**
   * Creates or updates a page in Confluence
   * Supports both new options object and legacy parameter signature
   */
  async createOrUpdatePage(
    spaceKeyOrOptions: string | CreateOrUpdatePageOptions,
    title?: string,
    content?: ADFEntity,
    parentId?: string,
    pageId?: string,
    labels?: string[]
  ): Promise<unknown> {
    // Handle both new and old signatures
    if (typeof spaceKeyOrOptions === 'object') {
      // New signature: options object
      return this._createOrUpdatePageImpl(spaceKeyOrOptions);
    }
    // Old signature: individual parameters (backward compatibility)
    if (!title || !content) {
      throw new Error('title and content are required when using legacy signature');
    }
    return this._createOrUpdatePageImpl({
      spaceKey: spaceKeyOrOptions,
      title,
      content: { format: 'adf', data: content },
      parentId,
      pageId,
      labels,
    });
  }

  /**
   * Internal implementation of createOrUpdatePage
   */
  private async _createOrUpdatePageImpl(options: CreateOrUpdatePageOptions): Promise<unknown> {
    const { spaceKey, title, content, parentId, pageId, labels } = options;

    this.log(`Creating or updating page "${title}" in space "${spaceKey}"`);

    try {
      let existingPage: ConfluenceResponse | null = null;

      // If pageId is provided, try to get the page directly
      if (pageId) {
        try {
          existingPage = await this.getPage(pageId);
          this.log(`Found page by ID ${pageId}`);
        } catch (_error) {
          this.log(`Could not find page with ID ${pageId}, will search by title`);
        }
      }

      // If no page found by ID, try to find by title AND parentId
      if (!existingPage) {
        this.log(`Searching for page by title "${title}" and parentId "${parentId || 'none'}"`);
        existingPage = await this.getPageByTitle(spaceKey, title, parentId);
      }

      // Convert PageContent to ADFEntity for internal methods
      const adfContent = this._convertToADFEntity(content);

      let result: ConfluenceResponse | null = null;
      if (existingPage) {
        // Update existing page
        this.log(`Page "${title}" exists with ID ${existingPage.id}, updating...`);
        const currentVersion = existingPage.version?.number || 1;
        result = await this.updatePage(existingPage.id, title, adfContent, currentVersion + 1);
      } else {
        try {
          // Create new page
          this.log(`Page "${title}" does not exist, creating new page...`);
          result = await this.createPage(spaceKey, title, adfContent, parentId);
        } catch (error: unknown) {
          // Improve error handling for duplicate title scenarios
          if (error instanceof Error && error.message?.includes('title already exists')) {
            // Try to find the page again, but ignore parentId this time
            this.log('Error creating page: Title conflict detected');
            this.log(`Searching for any page with title "${title}" regardless of parent...`);

            const conflictingPage = await this.getPageByTitle(spaceKey, title);
            if (conflictingPage) {
              this.log(`Found existing page with title "${title}" (ID: ${conflictingPage.id})`);
              throw new Error(
                `Cannot create page: A page with title "${title}" already exists in space "${spaceKey}". You must use a unique title for each page in a space, even across different parent pages. Try using a different title or update the existing page with ID ${conflictingPage.id}.`
              );
            }
          }
          // If not a title conflict or no conflicting page found, rethrow the original error
          throw error;
        }
      }

      // Handle labels if provided
      if (labels && labels.length > 0 && result && result.id) {
        this.log(`Adding ${labels.length} labels to page ${result.id}`);
        try {
          await this.addLabelsToPage(result.id, labels);
        } catch (error) {
          this.log(
            `Error adding labels: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
          // Don't fail the entire operation if just labels fail
        }
      }

      return result;
    } catch (error) {
      this.log(
        `Error in createOrUpdatePage: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      throw error;
    }
  }

  /**
   * Converts PageContent to ADFEntity for internal processing
   */
  private _convertToADFEntity(content: PageContent): ADFEntity {
    switch (content.format) {
      case 'wiki':
        // Wrap wiki markup in the wiki-markup node structure
        return {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'wiki-markup',
              content: [
                {
                  type: 'text',
                  text: content.data,
                },
              ],
            },
          ],
        };
      case 'storage':
        // For storage format, we need to wrap it similarly
        // The existing code will convert it back to storage format
        return {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'text',
              text: content.data,
            },
          ],
        };
      default:
        // Already in ADF format
        return content.data;
    }
  }

  private async _addLabelsToServerPage(pageId: string, labels: string[]): Promise<unknown> {
    const endpoint = this.buildApiEndpoint(`/content/${pageId}/label`);
    const body = labels.map((label) => ({ prefix: 'global', name: label }));
    this.log(`Adding labels to server page at: ${endpoint}`);
    return this._fetchJson(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async _addLabelsToCloudPage(pageId: string, labels: string[]): Promise<unknown> {
    // Cloud logic for adding labels is more involved
    // First get the page details (v2 API)
    const pageDetails = await this._getPageCloud(pageId); // Using the new _getPageCloud helper
    const pageTitle = pageDetails.title;
    const spaceId = pageDetails.space?.id;

    if (!spaceId) {
      throw new Error(`Could not determine spaceId for page ${pageId} to add labels.`);
    }

    // Now search for the content ID using the v1 API with the title and space (from pageDetails)
    const space = await this.getSpaceById(spaceId); // getSpaceById will also be refactored
    if (!space) {
      throw new Error(`Could not find space with ID ${spaceId}`);
    }
    const spaceKeyVal = space.key;

    const contentSearchEndpoint = this.buildApiEndpoint('/rest/api/content');
    const params = new URLSearchParams({
      title: pageTitle,
      spaceKey: spaceKeyVal,
      expand: 'version',
    });
    this.log(`Searching for cloud content (v1 API): ${contentSearchEndpoint}?${params}`);
    const contentResults = (await this._fetchJson(
      `${contentSearchEndpoint}?${params}`
    )) as ConfluenceSearchResponse;

    if (!contentResults.results || contentResults.results.length === 0) {
      throw new Error(
        `Could not find content with title "${pageTitle}" in space "${spaceKeyVal}" using v1 API.`
      );
    }
    const contentId = contentResults.results[0].id;
    this.log(`Found content ID ${contentId} for page ${pageId} (v1 API)`);

    // Now use v1 API to add labels
    const endpoint = this.buildApiEndpoint(`/rest/api/content/${contentId}/label`);
    const body = labels.map((label) => ({ prefix: 'global', name: label }));
    this.log(`Adding labels to cloud page (v1 API) at: ${endpoint}`);
    return this._fetchJson(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async addLabelsToPage(pageId: string, labels: string[]): Promise<unknown> {
    const effectiveInstanceType = this.getEffectiveInstanceType();
    if (effectiveInstanceType === 'server') {
      return this._addLabelsToServerPage(pageId, labels);
    }
    return this._addLabelsToCloudPage(pageId, labels);
  }

  private async _getSpaceByIdServer(spaceId: string): Promise<ConfluenceSpace | null> {
    const endpoint = this.buildApiEndpoint('/space');
    this.log(`Fetching server spaces to find ID ${spaceId} at: ${endpoint}`);
    const result = (await this._fetchJson(endpoint)) as ConfluenceSpaceResponse;
    const spaces: ConfluenceSpace[] = result.results || [];
    return spaces.find((s) => s.id.toString() === spaceId.toString()) || null;
  }

  private async _getSpaceByIdCloud(spaceId: string): Promise<ConfluenceSpace | null> {
    const endpoint = this.buildApiEndpoint(`/api/v2/spaces/${spaceId}`);
    this.log(`Fetching cloud space information for ID ${spaceId} at: ${endpoint}`);
    return this._fetchJson(endpoint) as Promise<ConfluenceSpace>;
  }

  // Helper method to get space by ID
  async getSpaceById(spaceId: string): Promise<ConfluenceSpace | null> {
    const effectiveInstanceType = this.getEffectiveInstanceType();
    if (effectiveInstanceType === 'server') {
      return this._getSpaceByIdServer(spaceId);
    }
    return this._getSpaceByIdCloud(spaceId);
  }

  // --- Image/attachment deduplication helpers ---

  // Prefix used to embed a content hash in an attachment's comment so re-runs can
  // detect whether an existing attachment has the same content as the local file.
  private static readonly HASH_COMMENT_PREFIX = 'sha256:';

  /** Compute the SHA-256 hex digest of a file's contents. */
  private hashFile(filePath: string): string | null {
    try {
      return createHash('sha256').update(readFileSync(filePath)).digest('hex');
    } catch (error) {
      // In tests the file may not exist; upstream callers simulate the upload.
      if (process.env.NODE_ENV === 'test') {
        this.log(`Test environment: skipping hash for ${filePath}`);
        return null;
      }
      throw error;
    }
  }

  /** Build a comment string that embeds the content hash for later dedup. */
  private buildAttachmentComment(baseComment: string | undefined, hash: string | null): string {
    const comment = baseComment || 'Uploaded via doc2confluence';
    if (!hash) {
      return comment;
    }
    return `${comment} ${ConfluenceClient.HASH_COMMENT_PREFIX}${hash}`;
  }

  /**
   * List the current attachments for a page (Cloud v2 or Server/DC), optionally
   * filtered by filename. Returns the raw result objects.
   */
  private async getPageAttachments(
    pageId: string,
    filename?: string
  ): Promise<Record<string, unknown>[]> {
    const effectiveInstanceType = this.getEffectiveInstanceType();
    let endpoint: string;
    if (effectiveInstanceType === 'server') {
      endpoint = this.buildApiEndpoint(`/content/${pageId}/child/attachment`);
      const params = new URLSearchParams({ expand: 'version,metadata,extensions' });
      if (filename) {
        params.set('filename', filename);
      }
      endpoint = `${endpoint}?${params}`;
    } else {
      endpoint = this.buildApiEndpoint(`/api/v2/pages/${pageId}/attachments`);
      const params = new URLSearchParams({ limit: '250' });
      if (filename) {
        params.set('filename', filename);
      }
      endpoint = `${endpoint}?${params}`;
    }

    try {
      const data = (await this._fetchJson(endpoint)) as { results?: Record<string, unknown>[] };
      return data?.results || [];
    } catch (error) {
      // Existence check is best-effort: on failure, fall back to uploading.
      this.log(`Could not list attachments for page ${pageId}: ${error}`);
      return [];
    }
  }

  /** Extract the comment text from an attachment result across Cloud/Server shapes. */
  private getAttachmentComment(attachment: Record<string, unknown>): string {
    if (typeof attachment.comment === 'string') {
      return attachment.comment;
    }
    const metadata = attachment.metadata as { comment?: unknown } | undefined;
    if (metadata && typeof metadata.comment === 'string') {
      return metadata.comment;
    }
    const extensions = attachment.extensions as { comment?: unknown } | undefined;
    if (extensions && typeof extensions.comment === 'string') {
      return extensions.comment;
    }
    return '';
  }

  /** Extract the file size from an attachment result across Cloud/Server shapes. */
  private getAttachmentFileSize(attachment: Record<string, unknown>): number | null {
    if (typeof attachment.fileSize === 'number') {
      return attachment.fileSize;
    }
    const extensions = attachment.extensions as { fileSize?: unknown } | undefined;
    if (extensions && typeof extensions.fileSize === 'number') {
      return extensions.fileSize;
    }
    return null;
  }

  /**
   * Find an existing attachment on a page that matches the given filename and content.
   * "Matches content" means: the stored sha256 marker equals `hash` when present, or
   * (for older uploads without a marker) the file size matches. Returns the matching
   * attachment as an ImageUploadResponse, or null if none matches.
   */
  private async findExistingAttachment(
    pageId: string,
    filename: string,
    hash: string | null,
    fileSize: number | null
  ): Promise<ImageUploadResponse | null> {
    const attachments = await this.getPageAttachments(pageId, filename);
    for (const attachment of attachments) {
      if (attachment.title !== filename) {
        continue;
      }
      const comment = this.getAttachmentComment(attachment);
      const storedHash = comment.includes(ConfluenceClient.HASH_COMMENT_PREFIX)
        ? comment.split(ConfluenceClient.HASH_COMMENT_PREFIX)[1]?.trim().split(/\s+/)[0]
        : null;

      let isSame = false;
      if (storedHash && hash) {
        isSame = storedHash === hash;
      } else {
        // No stored hash to compare against; fall back to file size when available.
        const existingSize = this.getAttachmentFileSize(attachment);
        isSame = existingSize != null && fileSize != null && existingSize === fileSize;
      }

      if (isSame) {
        return attachment as unknown as ImageUploadResponse;
      }
    }
    return null;
  }

  private async _uploadImageCloud(
    spaceKey: string,
    filePath: string,
    comment?: string
  ): Promise<ImageUploadResponse> {
    const endpoint = this.buildApiEndpoint(`/api/v2/spaces/${spaceKey}/attachments`);

    const form = new FormData();
    try {
      form.append('file', createReadStream(filePath));
    } catch (error) {
      if (process.env.NODE_ENV === 'test') {
        this.log(`Test environment: Simulating file upload for ${filePath}`);
      } else {
        throw error;
      }
    }
    form.append('comment', comment || 'Uploaded via md2confluence');
    // Cloud might not support minorEdit in the same way or at all for attachments via v2
    // form.append('minorEdit', 'true');

    this.log(`Uploading cloud image to: ${endpoint}`);
    return this._fetchJson(endpoint, {
      method: 'POST',
      headers: form.getHeaders(),
      body: form as unknown as BodyInit,
    }) as Promise<ImageUploadResponse>;
  }

  async uploadImage(
    spaceKey: string,
    filePath: string,
    comment?: string
  ): Promise<ImageUploadResponse> {
    const effectiveInstanceType = this.getEffectiveInstanceType();
    const filename = path.basename(filePath);

    if (effectiveInstanceType === 'server') {
      // Server attaches images to the space homepage, which is a normal page — so we
      // can reuse the page-based upload path and get full dedup (cache + remote check).
      const space = await this.getSpaceByKey(spaceKey);
      if (!space) {
        throw new Error(`Space with key "${spaceKey}" not found for Server image upload.`);
      }
      const homePageId = space.homepage ? space.homepage.id : space.homepageId;
      if (!homePageId) {
        throw new Error(
          `Could not find home page for space "${spaceKey}" for Server image upload.`
        );
      }
      return this.uploadAttachmentToPage(homePageId, filePath, filename, comment);
    }

    // Cloud attaches to the space (not a page), so we dedup via the in-memory cache only.
    return this._dedupUpload(
      `space:${spaceKey}`,
      null,
      filePath,
      filename,
      comment,
      (commentWithHash) => this._uploadImageCloud(spaceKey, filePath, commentWithHash)
    );
  }

  /**
   * Upload an attachment to a specific Confluence page
   * @param pageId The ID of the page to attach the file to
   * @param filePath Path to the file to upload
   * @param filename Optional custom filename (defaults to basename of filePath)
   * @param comment Optional comment for the attachment
   * @returns The uploaded attachment response
   */
  async uploadAttachmentToPage(
    pageId: string,
    filePath: string,
    filename?: string,
    comment?: string
  ): Promise<ImageUploadResponse> {
    const effectiveInstanceType = this.getEffectiveInstanceType();
    const actualFilename = filename || path.basename(filePath);

    return this._dedupUpload(
      `page:${pageId}`,
      pageId,
      filePath,
      actualFilename,
      comment,
      (commentWithHash) => {
        if (effectiveInstanceType === 'server') {
          return this._uploadAttachment(
            `/content/${pageId}/child/attachment`,
            filePath,
            actualFilename,
            commentWithHash,
            true // minorEdit for server
          );
        }
        return this._uploadAttachment(
          `/api/v2/pages/${pageId}/attachments`,
          filePath,
          actualFilename,
          commentWithHash,
          false // no minorEdit for cloud
        );
      }
    );
  }

  /** Return a file's size in bytes, or null if it can't be read (e.g. in tests). */
  private getFileSize(filePath: string): number | null {
    try {
      return statSync(filePath).size;
    } catch (error) {
      if (process.env.NODE_ENV === 'test') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Deduplicating upload wrapper. Skips the network upload when the same content is
   * already known (per-run cache) or already present on the page (remote check), and
   * embeds the content hash in the attachment comment so future runs can detect it.
   *
   * @param scope Cache-key scope, e.g. `page:{id}` or `space:{key}`
   * @param remotePageId Page to query for existing attachments, or null to skip the remote check
   * @param doUpload Performs the actual upload with the hash-annotated comment
   */
  private async _dedupUpload(
    scope: string,
    remotePageId: string | null,
    filePath: string,
    filename: string,
    comment: string | undefined,
    doUpload: (commentWithHash: string) => Promise<ImageUploadResponse>
  ): Promise<ImageUploadResponse> {
    const hash = this.hashFile(filePath);
    const cacheKey = `${scope}:${filename}:${hash ?? 'nohash'}`;

    const cached = this.uploadCache.get(cacheKey);
    if (cached) {
      this.log(`Skipping upload (already uploaded this run): ${filename}`);
      return cached;
    }

    if (remotePageId) {
      const fileSize = this.getFileSize(filePath);
      const existing = await this.findExistingAttachment(remotePageId, filename, hash, fileSize);
      if (existing) {
        this.log(`Skipping upload (identical attachment already present): ${filename}`);
        this.uploadCache.set(cacheKey, existing);
        return existing;
      }
    }

    const response = await doUpload(this.buildAttachmentComment(comment, hash));
    this.uploadCache.set(cacheKey, response);
    return response;
  }

  /**
   * Generic attachment upload helper (DRY)
   */
  private async _uploadAttachment(
    endpoint: string,
    filePath: string,
    filename: string,
    comment?: string,
    minorEdit?: boolean
  ): Promise<ImageUploadResponse> {
    const fullEndpoint = this.buildApiEndpoint(endpoint);

    const form = new FormData();
    try {
      form.append('file', createReadStream(filePath), filename);
    } catch (error) {
      if (process.env.NODE_ENV === 'test') {
        this.log(`Test environment: Simulating file upload for ${filePath}`);
      } else {
        throw error;
      }
    }

    form.append('comment', comment || 'Uploaded via doc2confluence');
    if (minorEdit) {
      form.append('minorEdit', 'true');
    }

    this.log(`Uploading attachment: ${fullEndpoint}`);
    return this._fetchJson(fullEndpoint, {
      method: 'POST',
      headers: form.getHeaders(),
      body: form as unknown as BodyInit,
    }) as Promise<ImageUploadResponse>;
  }

  /**
   * Process wiki markup content to upload images and convert paths to attachment references
   * @param wikiMarkup The wiki markup content containing image references
   * @param pageId The ID of the page to attach images to
   * @param baseDir The base directory to resolve relative image paths
   * @returns The processed wiki markup with updated image references
   */
  async processWikiMarkupImages(
    wikiMarkup: string,
    pageId: string,
    baseDir: string
  ): Promise<string> {
    // Pattern to match Confluence image syntax: !path/to/image.png!
    const imagePattern = /!([^!]+)!/g;
    const matches = Array.from(wikiMarkup.matchAll(imagePattern));

    if (matches.length === 0) {
      this.log('No images found in wiki markup');
      return wikiMarkup;
    }

    this.log(`Found ${matches.length} image(s) in wiki markup`);
    let processedMarkup = wikiMarkup;

    for (const match of matches) {
      const imagePath = match[1]; // e.g., "./evidence/staging/deployment.png"

      // Skip if it's already just a filename (no path separators)
      if (!imagePath.includes('/') && !imagePath.includes('\\')) {
        this.log(`Skipping image (already a filename): ${imagePath}`);
        continue;
      }

      // Skip URLs
      if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
        this.log(`Skipping external image: ${imagePath}`);
        continue;
      }

      try {
        // Resolve the full path
        const fullPath = path.resolve(baseDir, imagePath);
        const filename = path.basename(imagePath);

        this.log(`Uploading image: ${fullPath} as ${filename}`);

        // Upload the image as an attachment to the page
        await this.uploadAttachmentToPage(pageId, fullPath, filename);

        // Replace the path with just the filename
        processedMarkup = processedMarkup.replace(`!${imagePath}!`, `!${filename}!`);

        this.log(`✓ Uploaded and updated reference: ${imagePath} -> ${filename}`);
      } catch (error) {
        this.log(`✗ Failed to upload image ${imagePath}: ${error}`);
        // Continue with other images even if one fails
      }
    }

    return processedMarkup;
  }

  /**
   * Upload locally-referenced images in an ADF document as attachments on the given page,
   * rewriting each external media node into a file/attachment reference.
   *
   * The converter emits local images as `media` nodes with `attrs.type === 'external'` and a
   * local `url` (e.g. `images/diagram.png`). Those cannot be resolved by Confluence — on Server
   * they render as `<ac:image><ri:url .../></ac:image>` pointing at a bogus path. This pass
   * uploads each such image to the target page (so `ri:attachment ri:filename` resolves) and
   * rewrites the node to a `file` reference carrying both the attachment `id` (Cloud media) and
   * `filename` (Server storage). External http(s)/data URLs are left untouched.
   *
   * @param adf The ADF document to process (mutated in place)
   * @param pageId The ID of the page to attach images to
   * @param baseDir The base directory to resolve relative image paths
   * @returns Whether any media node was uploaded and rewritten
   */
  async processAdfImages(
    adf: ADFEntity,
    pageId: string,
    baseDir: string
  ): Promise<{ changed: boolean }> {
    // Collect all media nodes referencing a local file.
    const localMediaNodes: ADFEntity[] = [];
    const collect = (node: ADFEntity): void => {
      if (node.type === 'media') {
        const attrs = node.attrs as { type?: string; url?: string } | undefined;
        const url = attrs?.url;
        if (
          attrs?.type === 'external' &&
          typeof url === 'string' &&
          url.length > 0 &&
          !url.startsWith('http://') &&
          !url.startsWith('https://') &&
          !url.startsWith('data:')
        ) {
          localMediaNodes.push(node);
        }
      }
      if (Array.isArray(node.content)) {
        for (const child of node.content) {
          collect(child);
        }
      }
    };
    collect(adf);

    if (localMediaNodes.length === 0) {
      this.log('No local images found in ADF content');
      return { changed: false };
    }

    this.log(`Found ${localMediaNodes.length} local image(s) in ADF content`);
    let changed = false;

    for (const node of localMediaNodes) {
      const attrs = node.attrs as {
        type?: string;
        url?: string;
        alt?: string;
        id?: string;
        collection?: string;
        filename?: string;
      };
      const imagePath = attrs.url as string;

      try {
        const fullPath = path.resolve(baseDir, imagePath);
        const filename = path.basename(imagePath);

        this.log(`Uploading image: ${fullPath} as ${filename}`);
        const response = await this.uploadAttachmentToPage(pageId, fullPath, filename);

        // Rewrite the node into a file/attachment reference. Keep `alt`; drop the local `url`.
        node.attrs = {
          type: 'file',
          id: response.id,
          collection: 'contentId',
          filename,
          ...(attrs.alt ? { alt: attrs.alt } : {}),
        };
        changed = true;

        this.log(`✓ Uploaded and updated reference: ${imagePath} -> ${filename}`);
      } catch (error) {
        this.log(`✗ Failed to upload image ${imagePath}: ${error}`);
        // Leave the node as an external reference and continue with the rest.
      }
    }

    return { changed };
  }

  /**
   * Converts Atlassian Document Format (ADF) to Confluence Storage Format
   * This is needed for Server/Data Center API which doesn't support ADF directly
   */
  private convertADFToStorage(adf: ADFEntity): string {
    // Check if this is a Markdown macro
    if (this.isMarkdownMacroADF(adf)) {
      return this.createMarkdownMacroStorage(this.extractMarkdownContent(adf));
    }

    // Proper conversion from ADF to Storage format for Server/Data Center
    if (adf.type !== 'doc' || !adf.content || !Array.isArray(adf.content)) {
      return '<p>Invalid ADF document structure</p>';
    }

    return this.processADFNodes(adf.content);
  }

  /**
   * Checks if the ADF document contains a single Markdown macro
   */
  private isMarkdownMacroADF(adf: ADFEntity): boolean {
    if (
      adf.type !== 'doc' ||
      !adf.content ||
      !Array.isArray(adf.content) ||
      adf.content.length !== 1
    ) {
      return false;
    }

    const node = adf.content[0];
    const attrs = node.attrs as ExtensionAttrs;
    return (
      node.type === 'extension' &&
      typeof attrs === 'object' &&
      attrs !== null &&
      attrs.extensionType === 'com.atlassian.confluence.macro.core' &&
      attrs.extensionKey === 'markdown'
    );
  }

  private isWikiMarkupADF(adf: ADFEntity): boolean {
    if (
      adf.type !== 'doc' ||
      !adf.content ||
      !Array.isArray(adf.content) ||
      adf.content.length !== 1
    ) {
      return false;
    }

    const node = adf.content[0];
    return node.type === 'wiki-markup';
  }

  /**
   * Extracts the Markdown content from a Markdown macro ADF
   */
  private extractMarkdownContent(adf: ADFEntity): string {
    if (!this.isMarkdownMacroADF(adf)) {
      return '';
    }

    const node = adf.content?.[0];
    if (!node?.content || !Array.isArray(node.content) || node.content.length === 0) {
      return '';
    }

    const textNode = node.content[0];
    return typeof textNode.text === 'string' ? textNode.text : '';
  }

  private extractWikiMarkupContent(adf: ADFEntity): string {
    if (!this.isWikiMarkupADF(adf)) {
      return '';
    }

    const node = adf.content?.[0];
    if (!node?.content || !Array.isArray(node.content) || node.content.length === 0) {
      return '';
    }

    const textNode = node.content[0];
    return typeof textNode.text === 'string' ? textNode.text : '';
  }

  /**
   * Creates the storage format XML for a Markdown macro
   */
  private createMarkdownMacroStorage(markdownContent: string): string {
    // This is the simplest format that works with Confluence storage format
    return `<ac:structured-macro ac:name="markdown"><ac:plain-text-body><![CDATA[${markdownContent}]]></ac:plain-text-body></ac:structured-macro>`;
  }

  /**
   * Process ADF nodes recursively to convert to Storage format
   */
  private processADFNodes(nodes: ADFEntity[]): string {
    let result = '';

    for (const node of nodes) {
      switch (node.type) {
        case 'wiki-markup': {
          const wikiContent = this.getRawTextContentFromADFNodes(node.content || []);
          result += `<![CDATA[${wikiContent}]]>`;
          break;
        }
        case 'paragraph':
          result += `<p>${this.processADFNodes(node.content || [])}</p>`;
          break;
        case 'text': {
          let text = this.escapeHtml(typeof node.text === 'string' ? node.text : '');
          const marks = Array.isArray((node as { marks?: unknown }).marks)
            ? ((node as { marks?: unknown }).marks as unknown[])
            : [];
          for (const mark of marks) {
            if (typeof mark !== 'object' || !mark) continue;
            const markType = (mark as { type?: string }).type;
            switch (markType) {
              case 'strong':
                text = `<strong>${text}</strong>`;
                break;
              case 'em':
                text = `<em>${text}</em>`;
                break;
              case 'code':
                text = `<code>${text}</code>`;
                break;
              case 'link':
                text = `<a href="${(mark as { attrs?: { href?: string } }).attrs?.href || '#'}">${text}</a>`;
                break;
              case 'strike':
                text = `<s>${text}</s>`;
                break;
              case 'underline':
                text = `<u>${text}</u>`;
                break;
              case 'textColor':
                if ((mark as { attrs?: { color?: string } }).attrs?.color) {
                  text = `<span style="color:${(mark as { attrs: { color: string } }).attrs.color}">${text}</span>`;
                }
                break;
              case 'subsup': {
                const tag =
                  (mark as { attrs?: { type?: string } }).attrs?.type === 'sub' ? 'sub' : 'sup';
                text = `<${tag}>${text}</${tag}>`;
                break;
              }
            }
          }
          result += text;
          break;
        }
        case 'heading': {
          const level = (node.attrs as { level?: number })?.level || 1;
          result += `<h${level}>${this.processADFNodes(node.content || [])}</h${level}>`;
          break;
        }
        case 'bulletList':
          result += `<ul>${this.processADFNodes(node.content || [])}</ul>`;
          break;
        case 'orderedList':
          result += `<ol>${this.processADFNodes(node.content || [])}</ol>`;
          break;
        case 'listItem':
          result += `<li>${this.processADFNodes(node.content || [])}</li>`;
          break;
        case 'codeBlock': {
          const language = (node.attrs as { language?: string })?.language || '';
          // Use getRawTextContentFromADFNodes to get unescaped code content
          const codeContent = this.getRawTextContentFromADFNodes(node.content || []);

          if (language === 'mermaid') {
            // Wrap Mermaid code in a Markdown macro with Markdown code fences
            result += '<ac:structured-macro ac:name="markdown">';
            // Ensure newlines are correctly placed around the mermaid content
            result += `<ac:plain-text-body><![CDATA[\`\`\`mermaid\n${codeContent}\n\`\`\`]]></ac:plain-text-body></ac:structured-macro>`;
          } else {
            result += '<ac:structured-macro ac:name="code">';
            if (language) {
              result += `<ac:parameter ac:name="language">${language}</ac:parameter>`;
            }
            result += `<ac:plain-text-body><![CDATA[${codeContent}]]></ac:plain-text-body></ac:structured-macro>`;
          }
          break;
        }
        case 'blockquote':
          result += `<blockquote>${this.processADFNodes(node.content || [])}</blockquote>`;
          break;
        case 'panel': {
          const panelType = (node.attrs as { panelType?: string })?.panelType || 'info';
          result += `<ac:structured-macro ac:name="info">`;
          if (panelType !== 'info') {
            result += `<ac:parameter ac:name="type">${panelType}</ac:parameter>`;
          }
          result += `<ac:rich-text-body>${this.processADFNodes(node.content || [])}</ac:rich-text-body></ac:structured-macro>`;
          break;
        }
        case 'mediaSingle':
          result += this.processADFNodes(node.content || []);
          break;
        case 'media': {
          const attrs = node.attrs as
            | { type?: string; filename?: string; url?: string }
            | undefined;
          if (attrs?.type === 'file') {
            // For Server/Data Center, we need to use the attachment macro
            result += `<ac:image><ri:attachment ri:filename="${attrs.filename || ''}" /></ac:image>`;
          } else if (attrs?.type === 'external') {
            result += `<ac:image><ri:url ri:value="${attrs.url}" /></ac:image>`;
          }
          break;
        }
        case 'table':
          result += `<table><tbody>${this.processADFNodes(node.content || [])}</tbody></table>`;
          break;
        case 'tableRow':
          result += `<tr>${this.processADFNodes(node.content || [])}</tr>`;
          break;
        case 'tableCell': {
          const colspan = (node.attrs as { colspan?: number })?.colspan
            ? ` colspan="${(node.attrs as { colspan?: number })?.colspan}"`
            : '';
          const rowspan = (node.attrs as { rowspan?: number })?.rowspan
            ? ` rowspan="${(node.attrs as { rowspan?: number })?.rowspan}"`
            : '';
          result += `<td${colspan}${rowspan}>${this.processADFNodes(node.content || [])}</td>`;
          break;
        }
        case 'tableHeader': {
          const thColspan =
            node.attrs && (node.attrs as { colspan?: number }).colspan
              ? ` colspan="${(node.attrs as { colspan?: number }).colspan}"`
              : '';
          const thRowspan =
            node.attrs && (node.attrs as { rowspan?: number }).rowspan
              ? ` rowspan="${(node.attrs as { rowspan?: number }).rowspan}"`
              : '';
          result += `<th${thColspan}${thRowspan}>${this.processADFNodes(node.content || [])}</th>`;
          break;
        }
        case 'hardBreak':
          result += '<br />';
          break;
        case 'rule':
          result += '<hr />';
          break;
        case 'taskList':
          result += '<ac:structured-macro ac:name="tasklist">';
          result += '<ac:parameter ac:name="title">Task List</ac:parameter>';
          result += `<ac:rich-text-body>${this.processADFNodes(node.content || [])}</ac:rich-text-body>`;
          result += '</ac:structured-macro>';
          break;
        case 'taskItem': {
          const checked = (node.attrs && (node.attrs as { state?: string }).state) === 'DONE';
          result += `<ac:task><ac:task-status>${checked ? 'complete' : 'incomplete'}</ac:task-status>`;
          result += `<ac:task-body>${this.processADFNodes(node.content || [])}</ac:task-body></ac:task>`;
          break;
        }
        case 'extension': {
          // Handle extension macros like markdown
          const extAttrs = node.attrs as ExtensionAttrs | undefined;
          if (extAttrs?.extensionType === 'com.atlassian.confluence.macro.core') {
            if (extAttrs.extensionKey === 'markdown') {
              // Special handling for markdown macro
              result += '<ac:structured-macro ac:name="markdown">';
              if (node.content) {
                const markdownContent = this.getRawTextContentFromADFNodes(node.content);
                result += `<ac:plain-text-body><![CDATA[${markdownContent}]]></ac:plain-text-body>`;
              }
              result += '</ac:structured-macro>';
            } else {
              // Other macros
              result += `<ac:structured-macro ac:name="${extAttrs.extensionKey || 'info'}">`;
              if (extAttrs.parameters) {
                for (const [key, value] of Object.entries(extAttrs.parameters)) {
                  result += `<ac:parameter ac:name="${key}">${value}</ac:parameter>`;
                }
              }
              if (node.content) {
                result += `<ac:rich-text-body>${this.processADFNodes(node.content)}</ac:rich-text-body>`;
              }
              result += '</ac:structured-macro>';
            }
          }
          break;
        }
        default:
          // For unsupported types, try to process their content if available
          if (node.content && Array.isArray(node.content)) {
            result += this.processADFNodes(node.content);
          }
      }
    }

    return result;
  }

  // Helper method to escape HTML in text nodes
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Extracts raw text content from ADF text nodes, without HTML escaping.
   * Used for code blocks where raw content is needed.
   */
  private getRawTextContentFromADFNodes(nodes: ADFEntity[]): string {
    let rawText = '';
    for (const node of nodes) {
      if (node.type === 'text' && typeof node.text === 'string') {
        rawText += node.text;
      } else if (node.content && Array.isArray(node.content)) {
        // Potentially recurse if text is nested, though unlikely for simple code blocks
        rawText += this.getRawTextContentFromADFNodes(node.content);
      }
    }
    return rawText;
  }
}
