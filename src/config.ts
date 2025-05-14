import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export interface ConfluenceConfig {
  url: string;
  username: string;
  apiKey: string;
  defaultSpace?: string;
  defaultParentId?: string;
}

export function getConfluenceConfig(): ConfluenceConfig {
  const config: ConfluenceConfig = {
    url: process.env.CONFLUENCE_URL || '',
    username: process.env.CONFLUENCE_USERNAME || '',
    apiKey: process.env.CONFLUENCE_API_KEY || '',
    defaultSpace: process.env.CONFLUENCE_SPACE,
    defaultParentId: process.env.CONFLUENCE_PARENT_ID,
  };

  // Validate required fields
  const missingFields: string[] = [];
  if (!config.url) missingFields.push('CONFLUENCE_URL');
  if (!config.username) missingFields.push('CONFLUENCE_USERNAME');
  if (!config.apiKey) missingFields.push('CONFLUENCE_API_KEY');

  if (missingFields.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingFields.join(', ')}\n` +
      'Please set these variables in your environment or .env file.'
    );
  }

  // Ensure URL has correct format for API calls
  // The Confluence API endpoints start with /api/v2/...
  // Remove trailing slashes first to prevent double slashes
  config.url = config.url.replace(/\/+$/, '');

  // Add /wiki only if not already present to prevent /wiki/wiki issues
  if (!config.url.endsWith('/wiki')) {
    config.url = `${config.url}/wiki`;
  }

  return config;
}

export function validateSpaceKey(space?: string): string {
  const spaceKey = space || process.env.CONFLUENCE_SPACE;
  if (!spaceKey) {
    throw new Error(
      'Space key is required. Either provide --space option or set CONFLUENCE_SPACE environment variable.'
    );
  }
  return spaceKey;
}

export function getParentPageId(parent?: string): string | undefined {
  return parent || process.env.CONFLUENCE_PARENT_ID;
}