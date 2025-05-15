import { createReadStream } from 'node:fs';
import { ReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import FormData from 'form-data';

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

  // Helper to build the API endpoint properly based on baseUrl and instance type
  private buildApiEndpoint(path: string): string {
    // Important: Don't add '/wiki' if it's already in the baseUrl
    // The baseUrl from config should already include it
    const apiPath = path.startsWith('/') ? path : `/${path}`;

    // For Server/Data Center, use different API paths
    if (this.instanceType === 'server') {
      // Server/Data Center uses different API endpoints
      // If path already starts with /rest/, use it as-is
      if (path.startsWith('/rest/')) {
        return `${this.baseUrl}${apiPath}`;
      }
      // Otherwise, convert Cloud paths to Server/Data Center paths
      return `${this.baseUrl}/rest/api${apiPath}`;
    }

    // For Cloud, use the existing API paths
    return `${this.baseUrl}${apiPath}`;
  }

  // Add method to get space by key
  async getSpaceByKey(spaceKey: string): Promise<ConfluenceSpace | null> {
    let endpoint: string;
    let params: URLSearchParams;

    if (this.instanceType === 'server') {
      // Server/Data Center API endpoint
      endpoint = this.buildApiEndpoint(`/space/${spaceKey}`);
      params = new URLSearchParams(); // No params for specific space retrieval
    } else {
      // Cloud API endpoint
      endpoint = this.buildApiEndpoint('/api/v2/spaces');
      params = new URLSearchParams({
        key: spaceKey,
        status: 'current',
        limit: '1',
      });
    }

    const url = params.toString() ? `${endpoint}?${params}` : endpoint;
    this.log(`Fetching space information for key ${spaceKey} at: ${url}`);

    try {
      const response = await fetch(url, {
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData: unknown;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { message: errorText };
        }

        const error = new Error(
          `Failed to get space: ${typeof errorData === 'object' && errorData && 'message' in errorData ? (errorData as { message?: string }).message : response.statusText}`
        );
        if (this.debug) {
          console.error('Response status:', response.status);
          console.error('Response text:', errorText);
          console.error('Request URL:', url);
        }
        throw error;
      }

      const result = await response.json();

      // Format response based on instance type
      if (this.instanceType === 'server') {
        // Server/Data Center returns the space directly
        return result;
      }
      // Cloud returns a results array
      return (result as ConfluenceSpaceResponse).results[0] || null;
    } catch (error) {
      if (this.debug && !(error instanceof Error)) {
        console.error('Unexpected error:', error);
      }
      throw error;
    }
  }

  // Update createPage to use spaceId
  async createPage(
    spaceKey: string,
    title: string,
    content: ADFEntity,
    parentId?: string
  ): Promise<ConfluenceResponse> {
    let endpoint: string;
    let body: Record<string, unknown>;

    if (this.instanceType === 'server') {
      // Server/Data Center API endpoint and body format
      endpoint = this.buildApiEndpoint('/content');

      // For Server/Data Center, we need to create the body differently
      body = {
        type: 'page',
        title,
        space: {
          key: spaceKey,
        },
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
    } else {
      // Cloud API endpoint
      endpoint = this.buildApiEndpoint('/api/v2/pages');

      // First, get space ID from space key for Cloud
      const space = await this.getSpaceByKey(spaceKey);
      if (!space) {
        throw new Error(`Space with key "${spaceKey}" not found`);
      }

      this.log(`Found space: ${space.name} (ID: ${space.id})`);

      // Use spaceId instead of space.key for Cloud
      body = {
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
    }

    this.log(`Creating page at: ${endpoint}`);
    this.log(`Request body: ${JSON.stringify(body, null, 2)}`);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: this.getAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData: unknown;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          // If it's not JSON, use the text as is
          errorData = { message: errorText };
        }

        const error = new Error(
          `Failed to create page: ${typeof errorData === 'object' && errorData && 'message' in errorData ? (errorData as { message?: string }).message : response.statusText}`
        );
        if (this.debug) {
          console.error('Response status:', response.status);
          console.error('Response text:', errorText);
          console.error('Request details:', {
            endpoint,
            method: 'POST',
            headers: {
              Authorization: '**REDACTED**',
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify(body, null, 2),
          });
        }
        throw error;
      }

      return response.json() as Promise<ConfluenceResponse>;
    } catch (error) {
      if (this.debug && !(error instanceof Error)) {
        console.error('Unexpected error:', error);
      }
      throw error;
    }
  }

  async updatePage(
    pageId: string,
    title: string,
    content: ADFEntity,
    version: number
  ): Promise<ConfluenceResponse> {
    let endpoint: string;
    let body: Record<string, unknown>;

    if (this.instanceType === 'server') {
      // Server/Data Center API endpoint
      endpoint = this.buildApiEndpoint(`/content/${pageId}`);

      // Get current page info to keep space key and other details
      const currentPage = await this.getPage(pageId);

      // For Server/Data Center, format is different
      body = {
        id: pageId,
        type: 'page',
        title,
        space: {
          key: currentPage.space?.key,
        },
        body: {
          storage: {
            value: this.convertADFToStorage(content),
            representation: 'storage',
          },
        },
        version: {
          number: version,
        },
      };
    } else {
      // Cloud API endpoint
      endpoint = this.buildApiEndpoint(`/api/v2/pages/${pageId}`);

      body = {
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
    }

    this.log(`Updating page at: ${endpoint}`);
    this.log(`Request body: ${JSON.stringify(body, null, 2)}`);

    try {
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: this.getAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData: unknown;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { message: errorText };
        }

        const error = new Error(
          `Failed to update page: ${typeof errorData === 'object' && errorData && 'message' in errorData ? (errorData as { message?: string }).message : response.statusText}`
        );
        if (this.debug) {
          console.error('Response status:', response.status);
          console.error('Response text:', errorText);
          console.error('Request details:', {
            endpoint,
            method: 'PUT',
            headers: {
              Authorization: '**REDACTED**',
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify(body, null, 2),
          });
        }
        throw error;
      }

      return response.json() as Promise<ConfluenceResponse>;
    } catch (error) {
      if (this.debug && !(error instanceof Error)) {
        console.error('Unexpected error:', error);
      }
      throw error;
    }
  }

  async getPage(pageId: string): Promise<ConfluenceResponse> {
    let endpoint: string;

    if (this.instanceType === 'server') {
      // Server/Data Center API endpoint
      endpoint = this.buildApiEndpoint(`/content/${pageId}?expand=space,version,body.storage`);
    } else {
      // Cloud API endpoint
      endpoint = this.buildApiEndpoint(`/api/v2/pages/${pageId}`);
    }

    this.log(`Getting page from: ${endpoint}`);

    try {
      const response = await fetch(endpoint, {
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData: unknown;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { message: errorText };
        }

        const error = new Error(
          `Failed to get page: ${typeof errorData === 'object' && errorData && 'message' in errorData ? (errorData as { message?: string }).message : response.statusText}`
        );
        if (this.debug) {
          console.error('Response status:', response.status);
          console.error('Response text:', errorText);
        }
        throw error;
      }

      return response.json() as Promise<ConfluenceResponse>;
    } catch (error) {
      if (this.debug && !(error instanceof Error)) {
        console.error('Unexpected error:', error);
      }
      throw error;
    }
  }

  async getPageByTitle(
    spaceKey: string,
    title: string,
    parentId?: string
  ): Promise<ConfluenceResponse | null> {
    let endpoint: string;
    let params: URLSearchParams;

    if (this.instanceType === 'server') {
      // Server/Data Center API endpoint
      endpoint = this.buildApiEndpoint('/content');
      params = new URLSearchParams({
        title,
        spaceKey,
        expand: 'version,space,body.storage',
        status: 'current',
      });

      // For Server/Data Center, we need to fetch and then filter results
    } else {
      // First, get space ID from space key
      const space = await this.getSpaceByKey(spaceKey);
      if (!space) {
        throw new Error(`Space with key "${spaceKey}" not found`);
      }

      this.log(`Found space: ${space.name} (ID: ${space.id})`);

      // Use the space ID to search for pages
      endpoint = this.buildApiEndpoint('/api/v2/pages');
      params = new URLSearchParams({
        title,
        status: 'current',
        limit: '100', // Increase limit to find pages with same title
        spaceId: space.id,
      });
    }

    this.log(`Searching for page at: ${endpoint}?${params}`);

    try {
      const response = await fetch(`${endpoint}?${params}`, {
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData: unknown;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { message: errorText };
        }

        const error = new Error(
          `Failed to search pages: ${typeof errorData === 'object' && errorData && 'message' in errorData ? (errorData as { message?: string }).message : response.statusText}`
        );
        if (this.debug) {
          console.error('Response status:', response.status);
          console.error('Response text:', errorText);
          console.error('Request URL:', `${endpoint}?${params}`);
        }
        throw error;
      }

      let results: ConfluenceResponse[];
      if (this.instanceType === 'server') {
        // Server/Data Center response format
        const data = await response.json();
        results = data.results || [];
      } else {
        // Cloud response format
        const data = (await response.json()) as ConfluenceSearchResponse;
        results = data.results || [];
      }

      if (!results || results.length === 0) {
        // No pages found with this title
        return null;
      }

      // If we have results but no parentId is specified, just return the first match
      if (!parentId) {
        this.log(`Found page with title "${title}" (no parent specified)`);
        return results[0];
      }

      // If parentId is provided, we need to check each result for matching parentId
      this.log(
        `Found ${results.length} pages with title "${title}", checking for parentId "${parentId}"`
      );

      // First try checking if any of the returned results already have parentId property
      const pageWithParent = results.find((page: ConfluenceResponse) => {
        if (this.instanceType === 'server') {
          // For Server/Data Center, check ancestors
          return page.ancestors?.some((ancestor) => ancestor.id === parentId);
        }
        // For Cloud API
        return page.parentId === parentId;
      });

      if (pageWithParent) {
        this.log('Found page with matching parentId directly in results');
        return pageWithParent;
      }

      // We need to fetch full details for each page to check parentId
      for (const page of results) {
        try {
          const pageDetails = await this.getPage(page.id);
          // Check if the page has the specified parentId
          if (this.instanceType === 'server') {
            // For Server/Data Center, check ancestors
            if (
              pageDetails.ancestors?.some((ancestor: { id: string }) => ancestor.id === parentId)
            ) {
              this.log(`Found page with matching parentId in ancestors: ${pageDetails.id}`);
              return page;
            }
          } else {
            // For Cloud API
            if (pageDetails && 'parentId' in pageDetails && pageDetails.parentId === parentId) {
              this.log(`Found page with matching parentId: ${pageDetails.id}`);
              return page;
            }
          }
        } catch (error) {
          this.log(
            `Error getting details for page ${page.id}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      // If we're looking for a specific parent but none match, we should handle this specially
      // Return the first page with the matching title but log a warning
      if (results.length > 0) {
        this.log(`WARNING: Found pages with title "${title}" but none with parentId "${parentId}"`);
        this.log(
          'Returning first matching page, but Confluence may reject creation due to title conflict'
        );
        return results[0];
      }

      // No pages found that match both title and parentId
      return null;
    } catch (error) {
      if (this.debug && !(error instanceof Error)) {
        console.error('Unexpected error:', error);
      }
      throw error;
    }
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

  async addLabelsToPage(pageId: string, labels: string[]): Promise<unknown> {
    try {
      let endpoint: string;
      let method: string;
      let body: { prefix: string; name: string }[];

      if (this.instanceType === 'server') {
        // Server/Data Center API endpoint
        endpoint = this.buildApiEndpoint(`/content/${pageId}/label`);
        method = 'POST';
        // Format labels for Server/Data Center
        body = labels.map((label) => ({
          prefix: 'global',
          name: label,
        }));
      } else {
        // Find content ID by querying for page by title, since we have the page details
        // First get the page details
        const pageEndpoint = this.buildApiEndpoint(`/api/v2/pages/${pageId}`);
        this.log(`Getting page details: ${pageEndpoint}`);

        const pageResponse = await fetch(pageEndpoint, {
          method: 'GET',
          headers: this.getAuthHeaders(),
        });

        if (!pageResponse.ok) {
          const errorText = await pageResponse.text();
          throw new Error(`Failed to get page details: ${errorText}`);
        }

        const pageDetails = await pageResponse.json();
        const pageTitle = pageDetails.title;
        const spaceId = pageDetails.spaceId;

        // Now search for the content ID using the v1 API with the title and space
        const space = await this.getSpaceById(spaceId);
        if (!space) {
          throw new Error(`Could not find space with ID ${spaceId}`);
        }

        const spaceKey = space.key;

        // Use content search by title
        const contentEndpoint = this.buildApiEndpoint('/rest/api/content');
        const params = new URLSearchParams({
          title: pageTitle,
          spaceKey: spaceKey,
          expand: 'version',
        });

        this.log(`Searching for content: ${contentEndpoint}?${params}`);

        const contentResponse = await fetch(`${contentEndpoint}?${params}`, {
          method: 'GET',
          headers: this.getAuthHeaders(),
        });

        if (!contentResponse.ok) {
          const errorText = await contentResponse.text();
          throw new Error(`Failed to search for content: ${errorText}`);
        }

        const contentResults = await contentResponse.json();

        if (!contentResults.results || contentResults.results.length === 0) {
          throw new Error(
            `Could not find content with title "${pageTitle}" in space "${spaceKey}"`
          );
        }

        const contentId = contentResults.results[0].id;
        this.log(`Found content ID ${contentId} for page ${pageId}`);

        // Now use v1 API to add labels
        endpoint = this.buildApiEndpoint(`/rest/api/content/${contentId}/label`);
        method = 'POST';
        body = labels.map((label) => ({
          prefix: 'global',
          name: label,
        }));
      }

      this.log(`Adding labels to content at: ${endpoint}`);

      const response = await fetch(endpoint, {
        method,
        headers: this.getAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData: unknown;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { message: errorText };
        }

        const error = new Error(
          `Failed to add labels: ${typeof errorData === 'object' && errorData && 'message' in errorData ? (errorData as { message?: string }).message : response.statusText}`
        );
        if (this.debug) {
          console.error('Response status:', response.status);
          console.error('Response text:', errorText);
        }
        throw error;
      }

      return response.json();
    } catch (error) {
      if (this.debug && !(error instanceof Error)) {
        console.error('Unexpected error:', error);
      }
      throw error;
    }
  }

  // Helper method to get space by ID
  async getSpaceById(spaceId: string): Promise<ConfluenceSpace | null> {
    let endpoint: string;

    if (this.instanceType === 'server') {
      // Server/Data Center - use v1 API and search for space by key
      // We need to list all spaces and filter by ID
      endpoint = this.buildApiEndpoint('/space');

      this.log(`Fetching spaces to find ID ${spaceId} at: ${endpoint}`);

      try {
        const response = await fetch(endpoint, {
          headers: this.getAuthHeaders(),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to get spaces: ${errorText}`);
        }

        const result = await response.json();
        const spaces = result.results || [];

        // Find the space with the matching ID
        const space = spaces.find((s: { id: string }) => s.id.toString() === spaceId.toString());
        return space || null;
      } catch (error) {
        if (this.debug && !(error instanceof Error)) {
          console.error('Unexpected error:', error);
        }
        throw error;
      }
    } else {
      // Cloud API
      endpoint = this.buildApiEndpoint(`/api/v2/spaces/${spaceId}`);
      this.log(`Fetching space information for ID ${spaceId} at: ${endpoint}`);

      try {
        const response = await fetch(endpoint, {
          headers: this.getAuthHeaders(),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to get space: ${errorText}`);
        }

        const result = await response.json();
        return result as ConfluenceSpace;
      } catch (error) {
        if (this.debug && !(error instanceof Error)) {
          console.error('Unexpected error:', error);
        }
        throw error;
      }
    }
  }

  async uploadImage(
    spaceKey: string,
    filePath: string,
    comment?: string
  ): Promise<ImageUploadResponse> {
    let endpoint: string;

    if (this.instanceType === 'server') {
      // For Server/Data Center, we need to get the space home page first
      const space = await this.getSpaceByKey(spaceKey);
      if (!space) {
        throw new Error(`Space with key "${spaceKey}" not found`);
      }

      // Get the home page ID for the space
      const homePageId = space.homepage ? space.homepage.id : space.homepageId;

      if (!homePageId) {
        throw new Error(`Could not find home page for space "${spaceKey}"`);
      }

      endpoint = this.buildApiEndpoint(`/content/${homePageId}/child/attachment`);
    } else {
      // Cloud API endpoint
      endpoint = this.buildApiEndpoint(`/api/v2/spaces/${spaceKey}/attachments`);
    }

    this.log(`Uploading image to: ${endpoint}`);

    const form = new FormData();

    // Add the file to form data
    form.append('file', createReadStream(filePath));
    form.append('comment', comment || 'Uploaded via md2confluence');
    form.append('minorEdit', 'true');

    try {
      // Get form headers
      const formHeaders = form.getHeaders();

      // With Node.js native fetch, we need to use form-data compatible approach
      // by passing the form as a readable stream with the right headers
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: this.getAuthHeaders(formHeaders),
        // @ts-ignore - FormData from form-data is compatible with fetch but TypeScript doesn't know
        body: form,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData: unknown;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { message: errorText };
        }

        const error = new Error(
          `Failed to upload image: ${typeof errorData === 'object' && errorData && 'message' in errorData ? (errorData as { message?: string }).message : response.statusText}`
        );
        if (this.debug) {
          console.error('Response status:', response.status);
          console.error('Response text:', errorText);
        }
        throw error;
      }

      return response.json() as Promise<ImageUploadResponse>;
    } catch (error) {
      if (this.debug && !(error instanceof Error)) {
        console.error('Unexpected error:', error);
      }
      throw error;
    }
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
