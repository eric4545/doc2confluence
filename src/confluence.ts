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
  private debug: boolean;

  constructor(baseUrl: string, email: string, apiToken: string, debug = false) {
    // Remove trailing slashes to avoid path issues
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.email = email;
    this.apiToken = apiToken;
    this.debug = debug;
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
        headers: {
          'Authorization': `Basic ${Buffer.from(`${this.email}:${this.apiToken}`).toString('base64')}`,
          'Accept': 'application/json',
        },
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
        headers: {
          'Authorization': `Basic ${Buffer.from(`${this.email}:${this.apiToken}`).toString('base64')}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
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
              'Authorization': 'Basic **REDACTED**',
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
        headers: {
          'Authorization': `Basic ${Buffer.from(`${this.email}:${this.apiToken}`).toString('base64')}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
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
              'Authorization': 'Basic **REDACTED**',
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
        headers: {
          'Authorization': `Basic ${Buffer.from(`${this.email}:${this.apiToken}`).toString('base64')}`,
          'Accept': 'application/json',
        },
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

  async getPageByTitle(spaceKey: string, title: string): Promise<ConfluenceResponse | null> {
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
      limit: '1',
      spaceId: space.id
    });

    this.log(`Searching for page at: ${endpoint}?${params}`);

    try {
      const response = await fetch(`${endpoint}?${params}`, {
        headers: {
          'Authorization': `Basic ${Buffer.from(`${this.email}:${this.apiToken}`).toString('base64')}`,
          'Accept': 'application/json',
        },
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
      return results.results[0] || null;
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
    parentId?: string
  ): Promise<any> {
    this.log(`Creating or updating page "${title}" in space "${spaceKey}"`);

    try {
      // Try to find existing page
      const existingPage = await this.getPageByTitle(spaceKey, title);

      if (existingPage) {
        // Update existing page
        this.log(`Page "${title}" exists with ID ${existingPage.id}, updating...`);
        const currentVersion = existingPage.version?.number || 1;
        return this.updatePage(existingPage.id, title, content, currentVersion + 1);
      } else {
        // Create new page
        this.log(`Page "${title}" does not exist, creating new page...`);
        return this.createPage(spaceKey, title, content, parentId);
      }
    } catch (error) {
      this.log(`Error in createOrUpdatePage: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
        headers: {
          'Authorization': `Basic ${Buffer.from(`${this.email}:${this.apiToken}`).toString('base64')}`,
          ...form.getHeaders(),
        },
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