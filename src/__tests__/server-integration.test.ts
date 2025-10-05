import assert from 'node:assert';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import dotenv from 'dotenv';
import { ConfluenceClient } from '../confluence';

// Set up the environment from .env
dotenv.config();

// Mock global fetch
const mockFetch = mock.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));

describe('Server/Data Center Integration Tests', () => {
  // These tests will only run if CONFLUENCE_TEST_SERVER_INTEGRATION is set to 'true'
  // and CONFLUENCE_URL, CONFLUENCE_USERNAME and CONFLUENCE_API_KEY are set for a server instance
  const runIntegrationTests = process.env.CONFLUENCE_TEST_SERVER_INTEGRATION === 'true';

  let fetchMock: ReturnType<typeof mock.method>;

  beforeEach(() => {
    fetchMock = mock.method(global, 'fetch', mockFetch);
  });

  // Clean up mocks after each test
  afterEach(() => {
    fetchMock.mock.restore();
  });

  // Test client instantiation with server instance type
  it('should initialize client with server instance type', () => {
    const client = new ConfluenceClient(
      'https://confluence-server.example.com',
      {
        email: 'test@example.com',
        apiToken: 'test-api-token',
      },
      false,
      'server'
    );

    // We can't test private properties directly, but we can check the type exists
    assert.ok(client !== undefined);
  });

  // Test that server API endpoints are used correctly
  it('should use correct Server/Data Center API endpoints', async () => {
    // Mock successful responses for our API calls
    mockFetch.mock.mockImplementation((url) => {
      if (url.includes('/space/TEST')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ key: 'TEST', id: '123', name: 'Test Space' }),
        });
      }
      if (url.includes('/content')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: '456',
              title: 'Test Page',
              type: 'page',
              status: 'current',
              space: { key: 'TEST' },
              version: { number: 1 },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const client = new ConfluenceClient(
      'https://server.example.com',
      {
        email: 'test@example.com',
        apiToken: 'test-token',
      },
      true, // debug
      'server'
    );

    // Test space endpoint
    await client.getSpaceByKey('TEST');
    assert.ok(mockFetch.mock.calls.length > 0);
    const spaceCall = mockFetch.mock.calls[0];
    assert.ok(spaceCall.arguments[0].includes('/rest/api/space?spaceKey=TEST'));

    mockFetch.mock.resetCalls();

    // Test content creation endpoint
    const testContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Test' }] }],
    };
    await client.createPage('TEST', 'Test Page', testContent);
    assert.ok(mockFetch.mock.calls.length > 0);
    const createCall = mockFetch.mock.calls[0];
    assert.ok(createCall.arguments[0].includes('/content'));
    assert.strictEqual(createCall.arguments[1].method, 'POST');
    assert.ok(createCall.arguments[1].body.includes('"storage"'));

    // Verify we're using storage format, not ADF
    const body = JSON.parse(createCall.arguments[1].body);
    assert.strictEqual(body.body.storage.representation, 'storage');
    assert.strictEqual(body.type, 'page');
    assert.strictEqual(body.space.key, 'TEST');
  });

  // Use conditional tests for real server integration
  (runIntegrationTests ? it : it.skip)('should fetch space by key from server', async () => {
    // Use real fetch, not mock for integration test
    mockFetch.mock.mockImplementation((url: string, options: RequestInit) => {
      console.log(`Sending request to ${url}`);
      // Use global fetch
      return global.fetch(url, options);
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

    assert.ok(space !== undefined);
    assert.strictEqual(space?.key, spaceKey);
  });

  (runIntegrationTests ? it : it.skip)('should create a page in server', async () => {
    // Skip mock for integration test
    mockFetch.mock.mockImplementation((url: string, options: RequestInit) => {
      console.log(`Sending request to ${url}`);
      // Use global fetch
      return global.fetch(url, options);
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
      assert.ok(page !== undefined);
      assert.strictEqual(page.title, uniqueTitle);
      console.log(`Created test page with ID: ${page.id}`);
    } catch (error) {
      console.error('Test failed:', error);
      throw error;
    }
  });

  // Test ADF to Storage Format conversion
  it('should convert ADF to Storage Format correctly for Server APIs', async () => {
    // Spy on the convertADFToStorage method
    const client = new ConfluenceClient(
      'https://server.example.com',
      {
        email: 'test@example.com',
        apiToken: 'test-token',
      },
      false,
      'server'
    );

    // @ts-ignore - accessing private method for testing
    const spy = mock.method(
      client as unknown as {
        convertADFToStorage: (adf: import('../converter').ADFEntity) => string;
      },
      'convertADFToStorage'
    );

    mockFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      })
    );

    // Create a sample ADF document with various node types
    const adfDocument = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Test Heading' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Normal text ' },
            { type: 'text', text: 'Bold text', marks: [{ type: 'strong' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'Italic text', marks: [{ type: 'em' }] },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'List item 1' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'List item 2' }],
                },
              ],
            },
          ],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'javascript' },
          content: [{ type: 'text', text: 'console.log("Hello World");' }],
        },
      ],
    };

    await client.createPage('TEST', 'Test ADF Conversion', adfDocument);

    // Check that convertADFToStorage was called
    assert.ok(spy.mock.calls.length > 0);
    const convertedContent = spy.mock.calls[0].result;

    // Content should be converted to Storage Format
    assert.ok(convertedContent.includes('<h1>Test Heading</h1>'));
    assert.ok(
      convertedContent.includes(
        '<p>Normal text <strong>Bold text</strong> and <em>Italic text</em></p>'
      )
    );
    assert.ok(
      convertedContent.includes('<ul><li><p>List item 1</p></li><li><p>List item 2</p></li></ul>')
    );
    assert.ok(
      convertedContent.includes(
        '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">javascript</ac:parameter>'
      )
    );
    assert.ok(
      convertedContent.includes(
        '<ac:plain-text-body><![CDATA[console.log("Hello World");]]></ac:plain-text-body>'
      )
    );

    spy.mock.restore();
  });
});
