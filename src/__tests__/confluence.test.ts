// Set NODE_ENV for tests
process.env.NODE_ENV = 'test';

// We'll use global fetch
// Mock FormData first
jest.mock('form-data', () => {
  const MockFormData = jest.fn().mockImplementation(() => ({
    append: jest.fn(),
    pipe: jest.fn(),
    getBoundary: jest.fn(),
    getBuffer: jest.fn(),
    getLengthSync: jest.fn().mockReturnValue(0),
    getHeaders: jest.fn().mockReturnValue({
      'Content-Type': 'multipart/form-data; boundary=boundary',
    }),
  }));
  return MockFormData;
});

// Then import after mocking
import { ConfluenceClient } from '../confluence';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock fs for createReadStream
jest.mock('fs', () => ({
  // Return a simple object that won't cause TypeScript issues
  createReadStream: jest.fn().mockReturnValue({
    pipe: jest.fn(),
    on: jest.fn(),
  }),
}));

// Import FormData after mocking
// No need to re-import FormData since it's already mocked

interface MockResponse extends Partial<Response> {
  ok: boolean;
  json: jest.Mock;
  text?: jest.Mock;
  status?: number;
  statusText?: string;
}

describe('ConfluenceClient', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockClear();

    // Setup default mock response with a results array to prevent undefined errors
    const mockResponse: MockResponse = {
      ok: true,
      json: jest.fn().mockResolvedValue({ results: [] }),
      text: jest.fn().mockResolvedValue(''),
    };
    mockFetch.mockResolvedValue(mockResponse as Response);
  });

  describe('Authentication', () => {
    test('should initialize with basic auth', () => {
      // Setup specific mock response for this test
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ results: [] }),
      } as MockResponse);

      const client = new ConfluenceClient(
        'https://example.atlassian.net',
        {
          email: 'test@example.com',
          apiToken: 'test-token',
        },
        false,
        'cloud'
      );

      // We can't test private properties directly, but we can test behavior
      expect(() => client.getSpaceByKey('TEST')).not.toThrow();
    });

    test('should initialize with PAT auth', () => {
      // Setup specific mock response for this test
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ results: [] }),
      } as MockResponse);

      const client = new ConfluenceClient(
        'https://example.atlassian.net',
        {
          personalAccessToken: 'test-pat',
        },
        false,
        'cloud'
      );

      expect(() => client.getSpaceByKey('TEST')).not.toThrow();
    });

    test('should throw error for invalid auth', () => {
      expect(
        () =>
          new ConfluenceClient(
            'https://example.atlassian.net',
            {
              /* No auth provided */
            },
            false,
            'cloud'
          )
      ).toThrow('Authentication requires either email+apiToken or personalAccessToken');
    });

    test('should use Bearer header with PAT auth', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ results: [] }),
      } as MockResponse);

      const client = new ConfluenceClient(
        'https://example.atlassian.net',
        {
          personalAccessToken: 'test-pat',
        },
        false,
        'cloud'
      );

      await client.getSpaceByKey('TEST');

      // Verify correct Authorization header was used
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/v2/spaces');
      expect(options?.headers).toHaveProperty('Authorization', 'Bearer test-pat');
    });

    test('should use Basic header with email/apiToken auth', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ results: [] }),
      } as MockResponse);

      const client = new ConfluenceClient(
        'https://example.atlassian.net',
        {
          email: 'test@example.com',
          apiToken: 'test-token',
        },
        false,
        'cloud'
      );

      await client.getSpaceByKey('TEST');

      // Verify correct Authorization header was used
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/v2/spaces');
      const expectedAuthHeader = `Basic ${Buffer.from('test@example.com:test-token').toString('base64')}`;
      expect(options?.headers).toHaveProperty('Authorization', expectedAuthHeader);
    });
  });

  describe('Instance Type Configuration', () => {
    test('should use cloud API endpoints by default', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ results: [] }),
      } as MockResponse);

      const client = new ConfluenceClient(
        'https://example.atlassian.net',
        {
          email: 'test@example.com',
          apiToken: 'test-token',
        },
        false,
        'cloud'
      );

      await client.getSpaceByKey('TEST');

      // Verify cloud API endpoint is used
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/v2/spaces');
    });

    test('should use server API endpoints when instanceType is server', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ key: 'TEST' }),
      } as MockResponse);

      const client = new ConfluenceClient(
        'https://example-server.com',
        {
          email: 'test@example.com',
          apiToken: 'test-token',
        },
        false,
        'server'
      );

      await client.getSpaceByKey('TEST');

      // Verify server API endpoint is used
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/rest/api/space?spaceKey=TEST');
    });
  });

  describe('API Operations', () => {
    let client: ConfluenceClient;

    // Setup a client for API tests
    beforeEach(() => {
      client = new ConfluenceClient(
        'https://example.atlassian.net',
        {
          email: 'test@example.com',
          apiToken: 'test-token',
        },
        false,
        'cloud'
      );
    });

    test('getSpaceByKey should return space details', async () => {
      const mockSpace = {
        id: 'space-123',
        key: 'TEST',
        name: 'Test Space',
        type: 'global',
        status: 'current',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ results: [mockSpace] }),
      } as MockResponse);

      const result = await client.getSpaceByKey('TEST');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockSpace);
    });

    test('getSpaceByKey should handle API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Space not found',
        text: jest.fn().mockResolvedValue('{"message":"Space not found"}'),
      } as MockResponse);

      await expect(client.getSpaceByKey('NONEXISTENT')).rejects.toThrow(
        'API request failed: 404 Space not found'
      );
    });

    test('createPage should create a page in Confluence', async () => {
      // Mock getSpaceByKey response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          results: [{ id: 'space-123', key: 'TEST', name: 'Test Space' }],
        }),
      } as MockResponse);

      // Mock createPage response
      const createPageResponse = {
        id: 'page-456',
        type: 'page',
        status: 'current',
        title: 'Test Page',
        links: { webui: '/pages/123' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(createPageResponse),
      } as MockResponse);

      const content = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello World' }] }],
      };
      const result = await client.createPage('TEST', 'Test Page', content);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual(createPageResponse);

      // Verify second call is to create page
      const [url, options] = mockFetch.mock.calls[1];
      expect(url).toContain('/api/v2/pages');
      expect(options?.method).toBe('POST');

      // Verify request body
      if (options?.body) {
        const body = JSON.parse(options.body as string);
        expect(body).toHaveProperty('title', 'Test Page');
        expect(body).toHaveProperty('spaceId', 'space-123');
      }
    });

    test.skip('uploadImage should upload an image to Confluence', async () => {
      // Mock getSpaceByKey response first (for server API path)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          results: [
            {
              id: 'space-123',
              key: 'TEST',
              name: 'Test Space',
              homepage: { id: 'home-456' },
            },
          ],
        }),
      } as MockResponse);

      // Then mock the actual upload response
      const uploadResponse = {
        id: 'att-123',
        type: 'attachment',
        status: 'current',
        title: 'test-image.png',
        mediaType: 'image/png',
        fileSize: 12345,
        downloadUrl: '/download/attachments/123/test-image.png',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(uploadResponse),
      });

      const result = await client.uploadImage('TEST', 'test-image.png');

      expect(mockFetch).toHaveBeenCalledTimes(2); // One for getSpaceByKey, one for upload
      expect(result).toEqual(uploadResponse);
    });

    test('createOrUpdatePage should update existing page', async () => {
      // Mock getSpaceByKey response for searching by title
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          results: [{ id: 'space-123', key: 'TEST', name: 'Test Space' }],
        }),
      } as MockResponse);

      // Mock getPageByTitle response (finding existing page)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          results: [
            {
              id: 'page-789',
              type: 'page',
              status: 'current',
              title: 'Existing Page',
              version: { number: 1 },
            },
          ],
        }),
      } as MockResponse);

      // Mock updatePage response
      const updateResponse = {
        id: 'page-789',
        type: 'page',
        status: 'current',
        title: 'Existing Page',
        version: { number: 2 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(updateResponse),
      } as MockResponse);

      const content = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated Content' }] }],
      };
      const result = await client.createOrUpdatePage('TEST', 'Existing Page', content);

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result).toEqual(updateResponse);
    });
  });

  // Add new describe block for ADF to Storage Format Conversion
  describe('ADF to Storage Format Conversion', () => {
    let client: ConfluenceClient; // Use the client to access the private method

    beforeEach(() => {
      // Initialize a client instance - auth details don't matter for this test
      client = new ConfluenceClient('https://example.com', {
        email: 'test@example.com',
        apiToken: 'test-token',
      });
    });

    test('should convert ADF codeBlock with mermaid language to mermaid macro', () => {
      const adfInput = {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'codeBlock',
            attrs: {
              language: 'mermaid',
            },
            content: [
              {
                type: 'text',
                text: 'graph TD;\nA-->B;',
              },
            ],
          },
        ],
      };
      // Access the private method for testing via a type assertion
      const convertADFToStorage = (client as any).convertADFToStorage.bind(client);
      const expectedOutput =
        // This is the pre-normalized string. No spaces between adjacent tags.
        // The content inside CDATA should not have leading/trailing spaces for this test.
        '<ac:structured-macro ac:name="markdown"><ac:plain-text-body><![CDATA[```mermaid graph TD; A-->B; ```]]></ac:plain-text-body></ac:structured-macro>';

      const normalize = (str: string) => str.replace(/\s+/g, ' ').trim();
      // We compare the normalized versions
      expect(normalize(convertADFToStorage(adfInput))).toBe(expectedOutput); // expectedOutput is already normalized
    });

    test('should convert standard ADF codeBlock to code macro', () => {
      const adfInput = {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'codeBlock',
            attrs: {
              language: 'javascript',
            },
            content: [
              {
                type: 'text',
                text: 'console.log("Hello");',
              },
            ],
          },
        ],
      };
      const convertADFToStorage = (client as any).convertADFToStorage.bind(client);
      const expectedOutput =
        '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">javascript</ac:parameter><ac:plain-text-body><![CDATA[console.log("Hello");]]></ac:plain-text-body></ac:structured-macro>';
      expect(convertADFToStorage(adfInput)).toBe(expectedOutput);
    });

    test('should convert ADF text with strong mark to <strong> tag', () => {
      const adfInput = {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'This is bold text',
                marks: [{ type: 'strong' }],
              },
            ],
          },
        ],
      };
      const convertADFToStorage = (client as any).convertADFToStorage.bind(client);
      const expectedOutput = '<p><strong>This is bold text</strong></p>';
      expect(convertADFToStorage(adfInput)).toBe(expectedOutput);
    });

    test('should convert ADF taskList with formatted items to correct storage format', () => {
      const adfInput = {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { state: 'TODO' },
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Item one bold', marks: [{ type: 'strong' }] }],
                  },
                ],
              },
              {
                type: 'taskItem',
                attrs: { state: 'TODO' },
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      { type: 'text', text: 'Item two strikethrough', marks: [{ type: 'strike' }] },
                    ],
                  },
                ],
              },
              {
                type: 'taskItem',
                attrs: { state: 'DONE' }, // Test a completed item
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Item three italic', marks: [{ type: 'em' }] }],
                  },
                ],
              },
            ],
          },
        ],
      };
      const convertADFToStorage = (client as any).convertADFToStorage.bind(client);
      const expectedStorageFormat =
        '<ac:structured-macro ac:name="tasklist"><ac:parameter ac:name="title">Task List</ac:parameter><ac:rich-text-body>' +
        '<ac:task><ac:task-status>incomplete</ac:task-status><ac:task-body><p><strong>Item one bold</strong></p></ac:task-body></ac:task>' +
        '<ac:task><ac:task-status>incomplete</ac:task-status><ac:task-body><p><s>Item two strikethrough</s></p></ac:task-body></ac:task>' +
        '<ac:task><ac:task-status>complete</ac:task-status><ac:task-body><p><em>Item three italic</em></p></ac:task-body></ac:task>' +
        '</ac:rich-text-body></ac:structured-macro>';

      // Normalize both actual and expected to handle potential whitespace differences in macro generation
      const normalize = (str: string) => str.replace(/\s+/g, '').replace(/>\s+</g, '><');
      expect(normalize(convertADFToStorage(adfInput))).toBe(normalize(expectedStorageFormat));
    });

    // Add more tests for other ADF to Storage conversions here if needed
  });
});
