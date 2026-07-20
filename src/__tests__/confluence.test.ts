// Set NODE_ENV for tests
process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { ConfluenceClient } from '../confluence';

// Mock FormData
const _MockFormData = mock.fn(() => ({
  append: mock.fn(),
  pipe: mock.fn(),
  getBoundary: mock.fn(),
  getBuffer: mock.fn(),
  getLengthSync: mock.fn(() => 0),
  getHeaders: mock.fn(() => ({
    'Content-Type': 'multipart/form-data; boundary=boundary',
  })),
}));

// Mock global fetch
const mockFetch = mock.fn();

interface MockResponse extends Partial<Response> {
  ok: boolean;
  json: () => Promise<any>;
  text?: () => Promise<string>;
  status?: number;
  statusText?: string;
}

describe('ConfluenceClient', () => {
  let globalFetchMock: ReturnType<typeof mock.method>;

  // Setup mocks before each test
  beforeEach(() => {
    // Reset the mockFetch calls
    mockFetch.mock.resetCalls();

    // Setup fetch mock with default response
    const mockResponse: MockResponse = {
      ok: true,
      json: mock.fn(() => Promise.resolve({ results: [] })),
      text: mock.fn(() => Promise.resolve('')),
    };
    mockFetch.mock.mockImplementation(() => Promise.resolve(mockResponse as Response));
    globalFetchMock = mock.method(global, 'fetch', mockFetch);
  });

  // Clean up mocks after each test
  afterEach(() => {
    globalFetchMock.mock.restore();
  });

  describe('Authentication', () => {
    it('should initialize with basic auth', () => {
      // Setup specific mock response for this test
      mockFetch.mock.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: mock.fn(() => Promise.resolve({ results: [] })),
        } as MockResponse)
      );

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
      assert.doesNotThrow(() => client.getSpaceByKey('TEST'));
    });

    it('should initialize with PAT auth', () => {
      // Setup specific mock response for this test
      mockFetch.mock.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: mock.fn(() => Promise.resolve({ results: [] })),
        } as MockResponse)
      );

      const client = new ConfluenceClient(
        'https://example.atlassian.net',
        {
          personalAccessToken: 'test-pat',
        },
        false,
        'cloud'
      );

      assert.doesNotThrow(() => client.getSpaceByKey('TEST'));
    });

    it('should throw error for invalid auth', () => {
      assert.throws(
        () =>
          new ConfluenceClient(
            'https://example.atlassian.net',
            {
              /* No auth provided */
            },
            false,
            'cloud'
          ),
        {
          message: 'Authentication requires either email+apiToken or personalAccessToken',
        }
      );
    });

    it('should use Bearer header with PAT auth', async () => {
      mockFetch.mock.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: mock.fn(() => Promise.resolve({ results: [] })),
        } as MockResponse)
      );

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
      assert.strictEqual(mockFetch.mock.calls.length, 1);
      const url = mockFetch.mock.calls[0].arguments[0];
      const options = mockFetch.mock.calls[0].arguments[1];
      assert.ok(url.includes('/api/v2/spaces'));
      assert.strictEqual(options?.headers?.Authorization, 'Bearer test-pat');
    });

    it('should use Basic header with email/apiToken auth', async () => {
      mockFetch.mock.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: mock.fn(() => Promise.resolve({ results: [] })),
        } as MockResponse)
      );

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
      assert.strictEqual(mockFetch.mock.calls.length, 1);
      const url = mockFetch.mock.calls[0].arguments[0];
      const options = mockFetch.mock.calls[0].arguments[1];
      assert.ok(url.includes('/api/v2/spaces'));
      const expectedAuthHeader = `Basic ${Buffer.from('test@example.com:test-token').toString('base64')}`;
      assert.strictEqual(options?.headers?.Authorization, expectedAuthHeader);
    });
  });

  describe('Instance Type Configuration', () => {
    it('should use cloud API endpoints by default', async () => {
      mockFetch.mock.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: mock.fn(() => Promise.resolve({ results: [] })),
        } as MockResponse)
      );

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
      assert.strictEqual(mockFetch.mock.calls.length, 1);
      const url = mockFetch.mock.calls[0].arguments[0];
      assert.ok(url.includes('/api/v2/spaces'));
    });

    it('should use server API endpoints when instanceType is server', async () => {
      mockFetch.mock.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: mock.fn(() => Promise.resolve({ key: 'TEST' })),
        } as MockResponse)
      );

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
      assert.strictEqual(mockFetch.mock.calls.length, 1);
      const url = mockFetch.mock.calls[0].arguments[0];
      assert.ok(url.includes('/rest/api/space?spaceKey=TEST'));
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

    it('getSpaceByKey should return space details', async () => {
      const mockSpace = {
        id: 'space-123',
        key: 'TEST',
        name: 'Test Space',
        type: 'global',
        status: 'current',
      };

      mockFetch.mock.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: mock.fn(() => Promise.resolve({ results: [mockSpace] })),
        } as MockResponse)
      );

      const result = await client.getSpaceByKey('TEST');

      assert.strictEqual(mockFetch.mock.calls.length, 1);
      assert.deepStrictEqual(result, mockSpace);
    });

    it('getSpaceByKey should handle API errors', async () => {
      mockFetch.mock.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Space not found',
          text: mock.fn(() => Promise.resolve('{"message":"Space not found"}')),
        } as MockResponse)
      );

      await assert.rejects(async () => await client.getSpaceByKey('NONEXISTENT'), {
        message: 'API request failed: 404 Space not found',
      });
    });

    it('createPage should create a page in Confluence', async () => {
      let callCount = 0;

      // Mock getSpaceByKey response (first call)
      // Mock createPage response (second call)
      const createPageResponse = {
        id: 'page-456',
        type: 'page',
        status: 'current',
        title: 'Test Page',
        links: { webui: '/pages/123' },
      };

      mockFetch.mock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: mock.fn(() =>
              Promise.resolve({
                results: [{ id: 'space-123', key: 'TEST', name: 'Test Space' }],
              })
            ),
          } as MockResponse);
        }
        return Promise.resolve({
          ok: true,
          json: mock.fn(() => Promise.resolve(createPageResponse)),
        } as MockResponse);
      });

      const content = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello World' }] }],
      };
      const result = await client.createPage('TEST', 'Test Page', content);

      assert.strictEqual(mockFetch.mock.calls.length, 2);
      assert.deepStrictEqual(result, createPageResponse);

      // Verify second call is to create page
      const url = mockFetch.mock.calls[1].arguments[0];
      const options = mockFetch.mock.calls[1].arguments[1];
      assert.ok(url.includes('/api/v2/pages'));
      assert.strictEqual(options?.method, 'POST');

      // Verify request body
      if (options?.body) {
        const body = JSON.parse(options.body as string);
        assert.strictEqual(body.title, 'Test Page');
        assert.strictEqual(body.spaceId, 'space-123');
      }
    });

    it.skip('uploadImage should upload an image to Confluence', async () => {
      let callCount = 0;

      // Mock getSpaceByKey response first (for server API path)
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

      mockFetch.mock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: mock.fn(() =>
              Promise.resolve({
                results: [
                  {
                    id: 'space-123',
                    key: 'TEST',
                    name: 'Test Space',
                    homepage: { id: 'home-456' },
                  },
                ],
              })
            ),
          } as MockResponse);
        }
        return Promise.resolve({
          ok: true,
          json: mock.fn(() => Promise.resolve(uploadResponse)),
        } as MockResponse);
      });

      const result = await client.uploadImage('TEST', 'test-image.png');

      assert.strictEqual(mockFetch.mock.calls.length, 2); // One for getSpaceByKey, one for upload
      assert.deepStrictEqual(result, uploadResponse);
    });

    it('createOrUpdatePage should update existing page', async () => {
      let callCount = 0;

      // Mock getSpaceByKey response for searching by title (first call)
      // Mock getPageByTitle response (finding existing page) (second call)
      // Mock updatePage response (third call)
      const updateResponse = {
        id: 'page-789',
        type: 'page',
        status: 'current',
        title: 'Existing Page',
        version: { number: 2 },
      };

      mockFetch.mock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: mock.fn(() =>
              Promise.resolve({
                results: [{ id: 'space-123', key: 'TEST', name: 'Test Space' }],
              })
            ),
          } as MockResponse);
        }
        if (callCount === 2) {
          return Promise.resolve({
            ok: true,
            json: mock.fn(() =>
              Promise.resolve({
                results: [
                  {
                    id: 'page-789',
                    type: 'page',
                    status: 'current',
                    title: 'Existing Page',
                    version: { number: 1 },
                  },
                ],
              })
            ),
          } as MockResponse);
        }
        return Promise.resolve({
          ok: true,
          json: mock.fn(() => Promise.resolve(updateResponse)),
        } as MockResponse);
      });

      const content = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated Content' }] }],
      };
      const result = await client.createOrUpdatePage('TEST', 'Existing Page', content);

      assert.strictEqual(mockFetch.mock.calls.length, 3);
      assert.deepStrictEqual(result, updateResponse);
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

    it('should convert ADF codeBlock with mermaid language to mermaid macro', () => {
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
      assert.strictEqual(normalize(convertADFToStorage(adfInput)), expectedOutput); // expectedOutput is already normalized
    });

    it('should convert standard ADF codeBlock to code macro', () => {
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
      assert.strictEqual(convertADFToStorage(adfInput), expectedOutput);
    });

    it('should convert ADF text with strong mark to <strong> tag', () => {
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
      assert.strictEqual(convertADFToStorage(adfInput), expectedOutput);
    });

    it('should convert ADF taskList with formatted items to correct storage format', () => {
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
      assert.strictEqual(
        normalize(convertADFToStorage(adfInput)),
        normalize(expectedStorageFormat)
      );
    });

    // Add more tests for other ADF to Storage conversions here if needed
  });

  describe('Image upload deduplication and rate limiting', () => {
    let client: ConfluenceClient;
    let tmpDir: string;
    let imagePath: string;
    let imageHash: string;
    const filename = 'diagram.png';

    // Helper: build a mock Response with a headers.get() implementation.
    const makeResponse = (
      overrides: Partial<MockResponse> & { retryAfter?: string }
    ): MockResponse => ({
      ok: overrides.ok ?? true,
      status: overrides.status ?? 200,
      statusText: overrides.statusText ?? 'OK',
      json: overrides.json ?? mock.fn(() => Promise.resolve({})),
      text: overrides.text ?? mock.fn(() => Promise.resolve('')),
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'retry-after' ? (overrides.retryAfter ?? null) : null,
      } as unknown as Headers,
    });

    // Count how many upload POSTs were issued (the attachment endpoints).
    const countUploadPosts = () =>
      mockFetch.mock.calls.filter((call) => {
        const opts = call.arguments[1] as { method?: string } | undefined;
        const url = call.arguments[0] as string;
        return opts?.method === 'POST' && url.includes('attachment');
      }).length;

    beforeEach(() => {
      client = new ConfluenceClient(
        'https://example.atlassian.net',
        { email: 'test@example.com', apiToken: 'test-token' },
        false,
        'cloud'
      );
      tmpDir = mkdtempSync(path.join(tmpdir(), 'doc2conf-img-'));
      imagePath = path.join(tmpDir, filename);
      const contents = Buffer.from('fake-png-bytes');
      writeFileSync(imagePath, contents);
      imageHash = createHash('sha256').update(contents).digest('hex');
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('uploads the same image only once within a run (in-memory cache)', async () => {
      const uploadResponse = { id: 'att-1', title: filename };
      // GET list (no existing) then POST upload; second call should hit the cache.
      mockFetch.mock.mockImplementation((_url: string, opts?: { method?: string }) => {
        if (opts?.method === 'POST') {
          return Promise.resolve(
            makeResponse({ json: mock.fn(() => Promise.resolve(uploadResponse)) })
          );
        }
        return Promise.resolve(
          makeResponse({ json: mock.fn(() => Promise.resolve({ results: [] })) })
        );
      });

      const first = await client.uploadAttachmentToPage('page-1', imagePath, filename);
      const second = await client.uploadAttachmentToPage('page-1', imagePath, filename);

      assert.deepStrictEqual(first, uploadResponse);
      assert.deepStrictEqual(second, uploadResponse);
      assert.strictEqual(countUploadPosts(), 1, 'should POST the upload exactly once');
    });

    it('skips upload when an identical attachment already exists (matching hash)', async () => {
      const existing = {
        id: 'att-existing',
        title: filename,
        comment: `Uploaded via doc2confluence sha256:${imageHash}`,
      };
      mockFetch.mock.mockImplementation((_url: string, opts?: { method?: string }) => {
        if (opts?.method === 'POST') {
          return Promise.resolve(
            makeResponse({ json: mock.fn(() => Promise.resolve({ id: 'should-not-happen' })) })
          );
        }
        return Promise.resolve(
          makeResponse({ json: mock.fn(() => Promise.resolve({ results: [existing] })) })
        );
      });

      const result = await client.uploadAttachmentToPage('page-1', imagePath, filename);

      assert.strictEqual((result as { id: string }).id, 'att-existing');
      assert.strictEqual(countUploadPosts(), 0, 'should not POST when identical attachment exists');
    });

    it('uploads when an attachment with the same name has different content', async () => {
      const existing = {
        id: 'att-old',
        title: filename,
        comment: 'Uploaded via doc2confluence sha256:deadbeefdifferenthash',
      };
      const uploadResponse = { id: 'att-new', title: filename };
      mockFetch.mock.mockImplementation((_url: string, opts?: { method?: string }) => {
        if (opts?.method === 'POST') {
          return Promise.resolve(
            makeResponse({ json: mock.fn(() => Promise.resolve(uploadResponse)) })
          );
        }
        return Promise.resolve(
          makeResponse({ json: mock.fn(() => Promise.resolve({ results: [existing] })) })
        );
      });

      const result = await client.uploadAttachmentToPage('page-1', imagePath, filename);

      assert.deepStrictEqual(result, uploadResponse);
      assert.strictEqual(countUploadPosts(), 1, 'should POST when content differs');
    });

    it('sends no-check XSRF header for attachment uploads', async () => {
      client = new ConfluenceClient(
        'https://confluence.rakuten-it.com/confluence',
        { personalAccessToken: 'test-pat' },
        false,
        'server'
      );

      const uploadResponse = { id: 'att-1', title: filename };
      mockFetch.mock.mockImplementation((_url: string, opts?: { method?: string }) => {
        if (opts?.method === 'POST') {
          return Promise.resolve(
            makeResponse({ json: mock.fn(() => Promise.resolve(uploadResponse)) })
          );
        }
        return Promise.resolve(
          makeResponse({ json: mock.fn(() => Promise.resolve({ results: [] })) })
        );
      });

      await client.uploadAttachmentToPage('page-1', imagePath, filename);

      const uploadCall = mockFetch.mock.calls.find((call) => {
        const opts = call.arguments[1] as { method?: string } | undefined;
        const url = call.arguments[0] as string;
        return opts?.method === 'POST' && url.includes('/child/attachment');
      });

      assert.ok(uploadCall, 'expected attachment upload POST call');
      const uploadOptions = uploadCall.arguments[1] as {
        body?: unknown;
        headers?: Record<string, string>;
      };
      const headers = uploadOptions.headers;
      assert.strictEqual(headers?.['X-Atlassian-Token'], 'no-check');
      assert.ok(
        Buffer.isBuffer(uploadOptions.body),
        'expected multipart upload body to be a Buffer'
      );
      assert.ok(Number(headers?.['Content-Length']) > 0, 'expected Content-Length header');
    });

    it('retries once on HTTP 429 then succeeds', async () => {
      const okData = { results: [{ id: 'space-1', key: 'TEST', name: 'Test Space' }] };
      let calls = 0;
      mockFetch.mock.mockImplementation(() => {
        calls++;
        if (calls === 1) {
          return Promise.resolve(
            makeResponse({
              ok: false,
              status: 429,
              statusText: 'Too Many Requests',
              retryAfter: '0',
            })
          );
        }
        return Promise.resolve(makeResponse({ json: mock.fn(() => Promise.resolve(okData)) }));
      });

      const result = await client.getSpaceByKey('TEST');
      assert.ok(result, 'should eventually succeed after a 429');
      assert.strictEqual(calls, 2, 'should retry exactly once');
    });

    it('throws after exhausting retries on persistent 429', async () => {
      mockFetch.mock.mockImplementation(() =>
        Promise.resolve(
          makeResponse({ ok: false, status: 429, statusText: 'Too Many Requests', retryAfter: '0' })
        )
      );

      await assert.rejects(() => client.getSpaceByKey('TEST'), /429/);
      assert.strictEqual(mockFetch.mock.calls.length, 4, 'should attempt 4 times total');
    });

    // Helper: build a minimal ADF doc with a single external-media image node.
    const adfWithImage = (url: string) => ({
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'mediaSingle',
          attrs: { layout: 'center' },
          content: [{ type: 'media', attrs: { type: 'external', url, alt: 'diagram' } }],
        },
      ],
    });

    it('processAdfImages uploads a local image and rewrites the media node', async () => {
      const uploadResponse = { id: 'att-42', title: filename };
      mockFetch.mock.mockImplementation((_url: string, opts?: { method?: string }) => {
        if (opts?.method === 'POST') {
          return Promise.resolve(
            makeResponse({ json: mock.fn(() => Promise.resolve(uploadResponse)) })
          );
        }
        return Promise.resolve(
          makeResponse({ json: mock.fn(() => Promise.resolve({ results: [] })) })
        );
      });

      const adf = adfWithImage(imagePath);
      const { changed } = await client.processAdfImages(adf as any, 'page-99', tmpDir);

      assert.strictEqual(changed, true);
      assert.strictEqual(countUploadPosts(), 1, 'should upload the local image once');
      const media = (adf.content[0].content as any[])[0];
      assert.strictEqual(media.attrs.type, 'file');
      assert.strictEqual(media.attrs.id, 'att-42');
      assert.strictEqual(media.attrs.collection, 'contentId');
      assert.strictEqual(media.attrs.filename, filename);
      assert.strictEqual(media.attrs.url, undefined, 'local url should be dropped');
      assert.strictEqual(media.attrs.alt, 'diagram', 'alt text should be preserved');
    });

    it('processAdfImages leaves external http(s) images untouched', async () => {
      const adf = adfWithImage('https://example.com/remote.png');
      const { changed } = await client.processAdfImages(adf as any, 'page-99', tmpDir);

      assert.strictEqual(changed, false);
      assert.strictEqual(countUploadPosts(), 0, 'should not upload an external URL');
      const media = (adf.content[0].content as any[])[0];
      assert.strictEqual(media.attrs.type, 'external');
      assert.strictEqual(media.attrs.url, 'https://example.com/remote.png');
    });

    it('processAdfImages uploads a repeated local image only once (dedup)', async () => {
      const uploadResponse = { id: 'att-7', title: filename };
      mockFetch.mock.mockImplementation((_url: string, opts?: { method?: string }) => {
        if (opts?.method === 'POST') {
          return Promise.resolve(
            makeResponse({ json: mock.fn(() => Promise.resolve(uploadResponse)) })
          );
        }
        return Promise.resolve(
          makeResponse({ json: mock.fn(() => Promise.resolve({ results: [] })) })
        );
      });

      // Two media nodes referencing the same local file.
      const adf = {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'mediaSingle',
            attrs: { layout: 'center' },
            content: [{ type: 'media', attrs: { type: 'external', url: imagePath, alt: 'a' } }],
          },
          {
            type: 'mediaSingle',
            attrs: { layout: 'center' },
            content: [{ type: 'media', attrs: { type: 'external', url: imagePath, alt: 'b' } }],
          },
        ],
      };

      const { changed } = await client.processAdfImages(adf as any, 'page-99', tmpDir);

      assert.strictEqual(changed, true);
      assert.strictEqual(countUploadPosts(), 1, 'same image should upload only once');
      for (const single of adf.content) {
        const media = (single.content as any[])[0];
        assert.strictEqual(media.attrs.type, 'file');
        assert.strictEqual(media.attrs.id, 'att-7');
      }
    });
  });
});
