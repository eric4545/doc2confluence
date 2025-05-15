// We'll use global fetch
import FormData from 'form-data';
import { ConfluenceClient } from '../confluence';

// Mock global fetch instead of node-fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock FormData
jest.mock('form-data');

// Mock fs for createReadStream
jest.mock('fs', () => ({
  createReadStream: jest.fn(() => 'mock-file-stream'),
}));

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
      expect(url).toContain('/space/TEST');
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
        statusText: 'Not Found',
        text: jest.fn().mockResolvedValue('Space not found'),
      } as MockResponse);

      await expect(client.getSpaceByKey('NONEXISTENT')).rejects.toThrow('Failed to get space');
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

    test('uploadImage should upload an image to Confluence', async () => {
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

      // Mock FormData getHeaders
      FormData.prototype.getHeaders = jest.fn().mockReturnValue({
        'Content-Type': 'multipart/form-data; boundary=boundary',
      });

      // Mock FormData append
      FormData.prototype.append = jest.fn();

      const result = await client.uploadImage('TEST', '/path/to/test-image.png');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).toEqual(uploadResponse);

      // Verify FormData was used correctly
      expect(FormData.prototype.append).toHaveBeenCalledWith('file', 'mock-file-stream');
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
});
