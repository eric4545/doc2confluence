import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Define the Confluence instance types
export type ConfluenceInstanceType = 'cloud' | 'server';

export interface ConfluenceConfig {
  url: string;
  // Support both authentication methods
  username?: string;  // For backward compatibility
  email?: string;     // New preferred name for username
  apiKey?: string;    // For backward compatibility
  personalAccessToken?: string; // New PAT auth method
  defaultSpace?: string;
  defaultParentId?: string;
  instanceType: ConfluenceInstanceType; // Added for server/data center support
}

export function getConfluenceConfig(): ConfluenceConfig {
  const config: ConfluenceConfig = {
    url: process.env.CONFLUENCE_URL || '',
    // Support both username and email env vars, prefer email if both exist
    username: process.env.CONFLUENCE_USERNAME || '',
    email: process.env.CONFLUENCE_EMAIL || process.env.CONFLUENCE_USERNAME || '',
    apiKey: process.env.CONFLUENCE_API_KEY || process.env.CONFLUENCE_API_TOKEN || '',
    personalAccessToken: process.env.CONFLUENCE_PAT || process.env.CONFLUENCE_PERSONAL_ACCESS_TOKEN || '',
    defaultSpace: process.env.CONFLUENCE_SPACE,
    defaultParentId: process.env.CONFLUENCE_PARENT_ID,
    instanceType: (process.env.CONFLUENCE_INSTANCE_TYPE as ConfluenceInstanceType) || 'cloud',
  };

  // Validate the instance type
  if (config.instanceType !== 'cloud' && config.instanceType !== 'server') {
    console.warn(`Invalid CONFLUENCE_INSTANCE_TYPE: ${config.instanceType}. Using default 'cloud'.`);
    config.instanceType = 'cloud';
  }

  // Validate required fields
  const missingFields: string[] = [];
  if (!config.url) missingFields.push('CONFLUENCE_URL');

  // Check if we have valid authentication
  const hasBasicAuth = (config.email || config.username) && config.apiKey;
  const hasPAT = !!config.personalAccessToken;

  if (!hasBasicAuth && !hasPAT) {
    if (!config.email && !config.username) missingFields.push('CONFLUENCE_EMAIL or CONFLUENCE_USERNAME');
    if (!config.apiKey && !config.personalAccessToken) missingFields.push('CONFLUENCE_API_KEY or CONFLUENCE_PERSONAL_ACCESS_TOKEN');
  }

  if (missingFields.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingFields.join(', ')}\n` +
      'Please set these variables in your environment or .env file.'
    );
  }

  // Ensure URL has correct format for API calls
  // Remove trailing slashes first to prevent double slashes
  config.url = config.url.replace(/\/+$/, '');

  // For Cloud, add /wiki if not already present to prevent /wiki/wiki issues
  if (config.instanceType === 'cloud' && !config.url.endsWith('/wiki')) {
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