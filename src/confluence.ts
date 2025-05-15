import fetch from 'node-fetch';
import { createReadStream } from 'fs';
import FormData from 'form-data';
import path from 'path';

// Define ADFEntity type since we can't import it
export interface ADFEntity {
  type: string;
  content?: ADFEntity[];
  [key: string]: any;
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
}

export interface ConfluenceSpaceResponse {
  results: ConfluenceSpace[];
}

export class ConfluenceClient {
  private baseUrl: string;
  private email: string;
  private apiToken: string;
  private personalAccessToken: string | null;
  private debug: boolean;
  private authType: 'basic' | 'pat';

  constructor(
    baseUrl: string,
    auth: {
      // Either provide email + apiToken for Basic auth
      email?: string;
      apiToken?: string;
      // Or provide a personal access token for PAT auth
      personalAccessToken?: string;
    },
    debug = false
  ) {
    // Remove trailing slashes to avoid path issues
    this.baseUrl = baseUrl.replace(/\/+$/, '');

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
    let authHeader;

    if (this.authType === 'pat') {
      authHeader = `Bearer ${this.personalAccessToken}`;
    } else {
      // Basic auth with email and API token
      authHeader = `Basic ${Buffer.from(`${this.email}:${this.apiToken}`).toString('base64')}`;
    }

    return {
      'Authorization': authHeader,
      'Accept': 'application/json',
      ...additionalHeaders
    };
  }

  private log(...args: any[]) {
    if (this.debug) {
      console.log(...args);
    }
  }

  // Helper to build the API endpoint properly based on baseUrl
  private buildApiEndpoint(path: string): string {
    // Important: Don't add '/wiki' if it's already in the baseUrl
    // The baseUrl from config should already include it
    const apiPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${apiPath}`;
  }

  // Add method to get space by key
  async getSpaceByKey(spaceKey: string): Promise<ConfluenceSpace | null> {
    const endpoint = this.buildApiEndpoint('/api/v2/spaces');
    const params = new URLSearchParams({
      key: spaceKey,
      status: 'current',
      limit: '1'
    });

    this.log(`Fetching space information for key ${spaceKey} at: ${endpoint}?${params}`);

    try {
      const response = await fetch(`${endpoint}?${params}`, {
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { message: errorText };
        }

        const error = new Error(`Failed to get space: ${errorData.message || response.statusText}`);
        if (this.debug) {
          console.error('Response status:', response.status);
          console.error('Response text:', errorText);
          console.error('Request URL:', `${endpoint}?${params}`);
        }
        throw error;
      }

      const result = await response.json() as ConfluenceSpaceResponse;
      return result.results[0] || null;
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
    const endpoint = this.buildApiEndpoint('/api/v2/pages');
    this.log(`Creating page at: ${endpoint}`);

    // First, get space ID from space key
    const space = await this.getSpaceByKey(spaceKey);
    if (!space) {
      throw new Error(`Space with key "${spaceKey}" not found`);
    }

    this.log(`Found space: ${space.name} (ID: ${space.id})`);

    // Use spaceId instead of space.key
    const body: any = {
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
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          // If it's not JSON, use the text as is
          errorData = { message: errorText };
        }

        const error = new Error(`Failed to create page: ${errorData.message || response.statusText}`);
        if (this.debug) {
          console.error('Response status:', response.status);
          console.error('Response text:', errorText);
          console.error('Request details:', {
            endpoint,
            method: 'POST',
            headers: {
              'Authorization': '**REDACTED**',
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify(body, null, 2)
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
    const endpoint = this.buildApiEndpoint(`/api/v2/pages/${pageId}`);
    this.log(`Updating page at: ${endpoint}`);

    const body = {
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

    try {
      this.log(`Request body: ${JSON.stringify(body, null, 2)}`);

      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: this.getAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { message: errorText };
        }

        const error = new Error(`Failed to update page: ${errorData.message || response.statusText}`);
        if (this.debug) {
          console.error('Response status:', response.status);
          console.error('Response text:', errorText);
          console.error('Request details:', {
            endpoint,
            method: 'PUT',
            headers: {
              'Authorization': '**REDACTED**',
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify(body, null, 2)
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
    const endpoint = this.buildApiEndpoint(`/api/v2/pages/${pageId}`);
    this.log(`Getting page from: ${endpoint}`);

    try {
      const response = await fetch(endpoint, {
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { message: errorText };
        }

        const error = new Error(`Failed to get page: ${errorData.message || response.statusText}`);
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

  async getPageByTitle(spaceKey: string, title: string, parentId?: string): Promise<ConfluenceResponse | null> {
    // First, get space ID from space key
    const space = await this.getSpaceByKey(spaceKey);
    if (!space) {
      throw new Error(`Space with key "${spaceKey}" not found`);
    }

    this.log(`Found space: ${space.name} (ID: ${space.id})`);

    // Use the space ID to search for pages
    const endpoint = this.buildApiEndpoint(`/api/v2/pages`);
    const params = new URLSearchParams({
      title,
      status: 'current',
      limit: '100', // Increase limit to find pages with same title
      spaceId: space.id
    });

    this.log(`Searching for page at: ${endpoint}?${params}`);

    try {
      const response = await fetch(`${endpoint}?${params}`, {
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { message: errorText };
        }

        const error = new Error(`Failed to search pages: ${errorData.message || response.statusText}`);
        if (this.debug) {
          console.error('Response status:', response.status);
          console.error('Response text:', errorText);
          console.error('Request URL:', `${endpoint}?${params}`);
        }
        throw error;
      }

      const results = await response.json() as ConfluenceSearchResponse;

      if (!results.results || results.results.length === 0) {
        // No pages found with this title
        return null;
      }

      // If we have results but no parentId is specified, just return the first match
      if (!parentId) {
        this.log(`Found page with title "${title}" (no parent specified)`);
        return results.results[0];
      }

      // If parentId is provided, we need to check each result for matching parentId
      this.log(`Found ${results.results.length} pages with title "${title}", checking for parentId "${parentId}"`);

      // First try checking if any of the returned results already have parentId property
      const pageWithParent = results.results.find(page => page.parentId === parentId);
      if (pageWithParent) {
        this.log(`Found page with matching parentId directly in results`);
        return pageWithParent;
      }

      // We need to fetch full details for each page to check parentId
      for (const page of results.results) {
        try {
          const pageDetails = await this.getPage(page.id);
          // Check if the page has the specified parentId
          if (pageDetails && 'parentId' in pageDetails && pageDetails.parentId === parentId) {
            this.log(`Found page with matching parentId: ${pageDetails.id}`);
            return page;
          }
        } catch (error) {
          this.log(`Error getting details for page ${page.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // If we're looking for a specific parent but none match, we should handle this specially
      // Return the first page with the matching title but log a warning
      if (results.results.length > 0) {
        this.log(`WARNING: Found pages with title "${title}" but none with parentId "${parentId}"`);
        this.log(`Returning first matching page, but Confluence may reject creation due to title conflict`);
        return results.results[0];
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
  ): Promise<any> {
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

      let result;
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
        } catch (error: any) {
          // Improve error handling for duplicate title scenarios
          if (error.message && error.message.includes("title already exists")) {
            // Try to find the page again, but ignore parentId this time
            this.log(`Error creating page: Title conflict detected`);
            this.log(`Searching for any page with title "${title}" regardless of parent...`);

            const conflictingPage = await this.getPageByTitle(spaceKey, title);
            if (conflictingPage) {
              this.log(`Found existing page with title "${title}" (ID: ${conflictingPage.id})`);
              throw new Error(
                `Cannot create page: A page with title "${title}" already exists in space "${spaceKey}". ` +
                `You must use a unique title for each page in a space, even across different parent pages. ` +
                `Try using a different title or update the existing page with ID ${conflictingPage.id}.`
              );
            }
          }
          // If not a title conflict or no conflicting page found, rethrow the original error
          throw error;
        }
      }

      // Handle labels if provided
      if (labels && labels.length > 0 && result.id) {
        this.log(`Adding ${labels.length} labels to page ${result.id}`);
        try {
          await this.addLabelsToPage(result.id, labels);
        } catch (error) {
          this.log(`Error adding labels: ${error instanceof Error ? error.message : 'Unknown error'}`);
          // Don't fail the entire operation if just labels fail
        }
      }

      return result;
    } catch (error) {
      this.log(`Error in createOrUpdatePage: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  async addLabelsToPage(pageId: string, labels: string[]): Promise<any> {
    try {
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
      const contentEndpoint = this.buildApiEndpoint(`/rest/api/content`);
      const params = new URLSearchParams({
        title: pageTitle,
        spaceKey: spaceKey,
        expand: 'version'
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
        throw new Error(`Could not find content with title "${pageTitle}" in space "${spaceKey}"`);
      }

      const contentId = contentResults.results[0].id;
      this.log(`Found content ID ${contentId} for page ${pageId}`);

      // Now use v1 API to add labels
      const endpoint = this.buildApiEndpoint(`/rest/api/content/${contentId}/label`);
      this.log(`Adding labels to content at: ${endpoint}`);

      const body = labels.map(label => ({
        prefix: "global",
        name: label
      }));

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { message: errorText };
        }

        const error = new Error(`Failed to add labels: ${errorData.message || response.statusText}`);
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
    const endpoint = this.buildApiEndpoint(`/api/v2/spaces/${spaceId}`);
    this.log(`Fetching space information for ID ${spaceId} at: ${endpoint}`);

    try {
      const response = await fetch(endpoint, {
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get space by ID: ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      if (this.debug && !(error instanceof Error)) {
        console.error('Unexpected error:', error);
      }
      throw error;
    }
  }

  async uploadImage(
    spaceKey: string,
    filePath: string,
    comment?: string
  ): Promise<ImageUploadResponse> {
    const endpoint = this.buildApiEndpoint(`/api/v2/spaces/${spaceKey}/attachments`);
    this.log(`Uploading image to: ${endpoint}`);

    const form = new FormData();

    // Add the file to form data
    form.append('file', createReadStream(filePath));
    form.append('comment', comment || `Uploaded via md2confluence`);
    form.append('minorEdit', 'true');

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: this.getAuthHeaders(form.getHeaders()),
        body: form,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { message: errorText };
        }

        const error = new Error(`Failed to upload image: ${errorData.message || response.statusText}`);
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
}