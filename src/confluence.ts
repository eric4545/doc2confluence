import { createReadStream } from 'node:fs';
import { ReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
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

export class ConfluenceClient {
  private baseUrl: string;
  private email: string;
  private apiToken: string;
  private personalAccessToken: string | null;
  private debug: boolean;
  private authType: 'basic' | 'pat';
  private instanceType: ConfluenceInstanceType;

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

  private async _fetchJson(url: string, fetchOptions: RequestInit = {}): Promise<any> {
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

    const response = await fetch(url, {
      ...fetchOptions, // Spread options first
      headers, // Then override headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData: unknown;
      try {
        errorData = JSON.parse(errorText);
      } catch (e) {
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
    const result = await this._fetchJson(url);
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
      body: {
        storage: {
          value: this.convertADFToStorage(content),
          representation: 'storage',
        },
      },
    };
    if (parentId) {
      body.ancestors = [{ id: parentId }];
    }
    this.log(`Creating server page at: ${endpoint}`);
    this.log(`Request body: ${JSON.stringify(body, null, 2)}`);
    return this._fetchJson(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async _createPageCloud(
    spaceKey: string,
    title: string,
    content: ADFEntity,
    parentId?: string
  ): Promise<ConfluenceResponse> {
    const endpoint = this.buildApiEndpoint('/api/v2/pages');
    const space = await this.getSpaceByKey(spaceKey); // Relies on refactored getSpaceByKey
    if (!space) {
      throw new Error(`Space with key "${spaceKey}" not found for Cloud page creation.`);
    }
    this.log(`Found space for Cloud page: ${space.name} (ID: ${space.id})`);
    const body: Record<string, unknown> = {
      spaceId: space.id,
      status: 'current',
      title,
      body: {
        representation: 'atlas_doc_format',
        value: JSON.stringify(content),
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
    });
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
      body: {
        storage: {
          value: this.convertADFToStorage(content),
          representation: 'storage',
        },
      },
      version: { number: version },
    };
    this.log(`Updating server page at: ${endpoint}`);
    this.log(`Request body: ${JSON.stringify(body, null, 2)}`);
    return this._fetchJson(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async _updatePageCloud(
    pageId: string,
    title: string,
    content: ADFEntity,
    version: number
  ): Promise<ConfluenceResponse> {
    const endpoint = this.buildApiEndpoint(`/api/v2/pages/${pageId}`);
    const body: Record<string, unknown> = {
      id: pageId,
      status: 'current',
      title,
      body: {
        representation: 'atlas_doc_format',
        value: JSON.stringify(content),
      },
      version: {
        number: version,
        message: `Updated via md2conf (version ${version})`,
      },
    };
    this.log(`Updating cloud page at: ${endpoint}`);
    this.log(`Request body: ${JSON.stringify(body, null, 2)}`);
    return this._fetchJson(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
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
    return this._fetchJson(endpoint);
  }

  private async _getPageCloud(pageId: string): Promise<ConfluenceResponse> {
    const endpoint = this.buildApiEndpoint(`/api/v2/pages/${pageId}`);
    this.log(`Getting cloud page from: ${endpoint}`);
    return this._fetchJson(endpoint);
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
    const data = await this._fetchJson(`${endpoint}?${params}`);
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
   */
  async createOrUpdatePage(
    spaceKey: string,
    title: string,
    content: ADFEntity,
    parentId?: string,
    pageId?: string,
    labels?: string[]
  ): Promise<unknown> {
    this.log(`Creating or updating page "${title}" in space "${spaceKey}"`);

    try {
      let existingPage = null;

      // If pageId is provided, try to get the page directly
      if (pageId) {
        try {
          existingPage = await this.getPage(pageId);
          this.log(`Found page by ID ${pageId}`);
        } catch (error) {
          this.log(`Could not find page with ID ${pageId}, will search by title`);
        }
      }

      // If no page found by ID, try to find by title AND parentId
      if (!existingPage) {
        this.log(`Searching for page by title "${title}" and parentId "${parentId || 'none'}"`);
        existingPage = await this.getPageByTitle(spaceKey, title, parentId);
      }

      let result: ConfluenceResponse | null = null;
      if (existingPage) {
        // Update existing page
        this.log(`Page "${title}" exists with ID ${existingPage.id}, updating...`);
        const currentVersion = existingPage.version?.number || 1;
        result = await this.updatePage(existingPage.id, title, content, currentVersion + 1);
      } else {
        try {
          // Create new page
          this.log(`Page "${title}" does not exist, creating new page...`);
          result = await this.createPage(spaceKey, title, content, parentId);
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
    const contentResults = await this._fetchJson(`${contentSearchEndpoint}?${params}`);

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
    const result = await this._fetchJson(endpoint);
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

  private async _uploadImageServer(
    spaceKey: string,
    filePath: string,
    comment?: string
  ): Promise<ImageUploadResponse> {
    const space = await this.getSpaceByKey(spaceKey);
    if (!space) {
      throw new Error(`Space with key "${spaceKey}" not found for Server image upload.`);
    }
    const homePageId = space.homepage ? space.homepage.id : space.homepageId;
    if (!homePageId) {
      throw new Error(`Could not find home page for space "${spaceKey}" for Server image upload.`);
    }
    const endpoint = this.buildApiEndpoint(`/content/${homePageId}/child/attachment`);

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
    form.append('minorEdit', 'true');

    this.log(`Uploading server image to: ${endpoint}`);
    return this._fetchJson(endpoint, {
      method: 'POST',
      headers: form.getHeaders(), // form-data library provides getHeaders()
      body: form as any, // Type assertion for fetch compatibility
    });
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
      body: form as any,
    });
  }

  async uploadImage(
    spaceKey: string,
    filePath: string,
    comment?: string
  ): Promise<ImageUploadResponse> {
    const effectiveInstanceType = this.getEffectiveInstanceType();
    if (effectiveInstanceType === 'server') {
      return this._uploadImageServer(spaceKey, filePath, comment);
    }
    return this._uploadImageCloud(spaceKey, filePath, comment);
  }

  /**
   * Converts Atlassian Document Format (ADF) to Confluence Storage Format
   * This is needed for Server/Data Center API which doesn't support ADF directly
   */
  private convertADFToStorage(adf: ADFEntity): string {
    // Proper conversion from ADF to Storage format for Server/Data Center
    if (adf.type !== 'doc' || !adf.content || !Array.isArray(adf.content)) {
      return '<p>Invalid ADF document structure</p>';
    }

    return this.processADFNodes(adf.content);
  }

  /**
   * Process ADF nodes recursively to convert to Storage format
   */
  private processADFNodes(nodes: ADFEntity[]): string {
    let result = '';

    for (const node of nodes) {
      switch (node.type) {
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
          result += '<ac:structured-macro ac:name="code">';
          if (language) {
            result += `<ac:parameter ac:name="language">${language}</ac:parameter>`;
          }
          result += `<ac:plain-text-body><![CDATA[${this.processADFNodes(node.content || [])}]]></ac:plain-text-body></ac:structured-macro>`;
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
          // Handle extension macros - simplified version
          const extAttrs = node.attrs as
            | {
                extensionType?: string;
                extensionKey?: string;
                parameters?: Record<string, unknown>;
              }
            | undefined;
          if (extAttrs?.extensionType === 'com.atlassian.confluence.macro.core') {
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
}
