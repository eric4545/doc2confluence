import { ConfluenceClient } from '../confluence';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Mock fetch for tests
jest.mock('node-fetch');
const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('Server/Data Center Integration Tests', () => {
  // These tests will only run if CONFLUENCE_TEST_SERVER_INTEGRATION is set to 'true'
  // and CONFLUENCE_URL, CONFLUENCE_USERNAME and CONFLUENCE_API_KEY are set for a server instance
  const runIntegrationTests = process.env.CONFLUENCE_TEST_SERVER_INTEGRATION === 'true';

  // Set up the environment from .env
  beforeAll(() => {
    dotenv.config();
  });

  // Clean up mocks after each test
  afterEach(() => {
    jest.resetAllMocks();
  });

  // Test client instantiation with server instance type
  test('should initialize client with server instance type', () => {
    const client = new ConfluenceClient(
      'https://confluence-server.example.com',
      {
        email: 'test@example.com',
        apiToken: 'test-api-token'
      },
      false,
      'server'
    );

    // We can't test private properties directly, but we can check the type exists
    expect(client).toBeDefined();
  });

  // Use conditional tests for real server integration
  (runIntegrationTests ? test : test.skip)('should fetch space by key from server', async () => {
    // Use real fetch, not mock for integration test
    mockFetch.mockImplementation((url: any, options: any) => {
      console.log(`Sending request to ${url}`);
      return (fetch as any).requireActual('node-fetch')(url, options);
    });

    const client = new ConfluenceClient(
      process.env.CONFLUENCE_URL || '',
      {
        email: process.env.CONFLUENCE_USERNAME || '',
        apiToken: process.env.CONFLUENCE_API_KEY || '',
      },
      true, // debug
      'server'
    );

    const spaceKey = process.env.CONFLUENCE_SPACE || '';
    const space = await client.getSpaceByKey(spaceKey);

    expect(space).toBeDefined();
    expect(space?.key).toBe(spaceKey);
  });

  (runIntegrationTests ? test : test.skip)('should create a page in server', async () => {
    // Skip mock for integration test
    mockFetch.mockImplementation((url: any, options: any) => {
      console.log(`Sending request to ${url}`);
      return (fetch as any).requireActual('node-fetch')(url, options);
    });

    const client = new ConfluenceClient(
      process.env.CONFLUENCE_URL || '',
      {
        email: process.env.CONFLUENCE_USERNAME || '',
        apiToken: process.env.CONFLUENCE_API_KEY || '',
      },
      true, // debug
      'server'
    );

    const spaceKey = process.env.CONFLUENCE_SPACE || '';
    const testContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Test content for Server/Data Center API.',
            },
          ],
        },
      ],
    };

    const uniqueTitle = `Test Page - ${new Date().toISOString()}`;

    try {
      const page = await client.createPage(spaceKey, uniqueTitle, testContent);
      expect(page).toBeDefined();
      expect(page.title).toBe(uniqueTitle);
      console.log(`Created test page with ID: ${page.id}`);
    } catch (error) {
      console.error('Test failed:', error);
      throw error;
    }
  });
});