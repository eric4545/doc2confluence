import { ConfluenceClient } from '../confluence';
import dotenv from 'dotenv';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

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

  // Test that server API endpoints are used correctly
  test('should use correct Server/Data Center API endpoints', async () => {
    // Mock successful responses for our API calls
    mockFetch.mockImplementation((url) => {
      if (url.includes('/space/TEST')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ key: 'TEST', id: '123', name: 'Test Space' }),
        });
      } else if (url.includes('/content')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            id: '456',
            title: 'Test Page',
            type: 'page',
            status: 'current',
            space: { key: 'TEST' },
            version: { number: 1 }
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const client = new ConfluenceClient(
      'https://server.example.com',
      {
        email: 'test@example.com',
        apiToken: 'test-token'
      },
      true, // debug
      'server'
    );

    // Test space endpoint
    await client.getSpaceByKey('TEST');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/space/TEST'),
      expect.any(Object)
    );

    mockFetch.mockClear();

    // Test content creation endpoint
    const testContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Test' }] }]
    };
    await client.createPage('TEST', 'Test Page', testContent);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/content'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"storage"')
      })
    );

    // Verify we're using storage format, not ADF
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.body.storage.representation).toBe('storage');
    expect(body.type).toBe('page');
    expect(body.space.key).toBe('TEST');
  });

  // Use conditional tests for real server integration
  (runIntegrationTests ? test : test.skip)('should fetch space by key from server', async () => {
    // Use real fetch, not mock for integration test
    mockFetch.mockImplementation((url: any, options: any) => {
      console.log(`Sending request to ${url}`);
      // Use global fetch
      return fetch(url, options);
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
      // Use global fetch
      return fetch(url, options);
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

  // Test ADF to Storage Format conversion
  test('should convert ADF to Storage Format correctly for Server APIs', async () => {
    // Spy on the convertADFToStorage method
    const client = new ConfluenceClient(
      'https://server.example.com',
      {
        email: 'test@example.com',
        apiToken: 'test-token'
      },
      false,
      'server'
    );

    // @ts-ignore - accessing private method for testing
    const spy = jest.spyOn(client as any, 'convertADFToStorage');

    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({}),
    });

    // Create a sample ADF document with various node types
    const adfDocument = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Test Heading' }]
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Normal text ' },
            { type: 'text', text: 'Bold text', marks: [{ type: 'strong' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'Italic text', marks: [{ type: 'em' }] }
          ]
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'List item 1' }]
                }
              ]
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'List item 2' }]
                }
              ]
            }
          ]
        },
        {
          type: 'codeBlock',
          attrs: { language: 'javascript' },
          content: [{ type: 'text', text: 'console.log("Hello World");' }]
        }
      ]
    };

    await client.createPage('TEST', 'Test ADF Conversion', adfDocument);

    // Check that convertADFToStorage was called
    expect(spy).toHaveBeenCalled();
    const convertedContent = spy.mock.results[0].value;

    // Content should be converted to Storage Format
    expect(convertedContent).toContain('<h1>Test Heading</h1>');
    expect(convertedContent).toContain('<p>Normal text <strong>Bold text</strong> and <em>Italic text</em></p>');
    expect(convertedContent).toContain('<ul><li><p>List item 1</p></li><li><p>List item 2</p></li></ul>');
    expect(convertedContent).toContain('<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">javascript</ac:parameter>');
    expect(convertedContent).toContain('<ac:plain-text-body><![CDATA[console.log(&quot;Hello World&quot;);]]></ac:plain-text-body>');

    spy.mockRestore();
  });
});