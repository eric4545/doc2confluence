process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ConfluenceClient, findLocalWikiImageRefs, ImageUploadError } from '../confluence';
import { Converter } from '../converter';
import { parseMarkdownFile } from '../metadata';
import {
  assertContentId,
  assertSecureUrl,
  cdata,
  IMAGE_EXTENSIONS,
  resolveLocalAsset,
  safeHref,
} from '../security';

describe('Security', () => {
  describe('front matter', () => {
    it('refuses JavaScript front matter instead of eval()ing it', () => {
      const marker = '__doc2conf_rce_marker__';
      const markdown = `---js
{ title: (globalThis.${marker} = true, 'x') }
---
# hi
`;
      assert.throws(() => parseMarkdownFile(markdown), /JavaScript front matter/);
      assert.strictEqual((globalThis as Record<string, unknown>)[marker], undefined);
    });

    it('still parses YAML front matter', () => {
      const { metadata } = parseMarkdownFile('---\ntitle: Hello\n---\n# Body\n');
      assert.strictEqual(metadata.title, 'Hello');
    });
  });

  describe('resolveLocalAsset', () => {
    let root: string;
    let docDir: string;
    let outside: string;
    let cwd: string;

    beforeEach(() => {
      cwd = process.cwd();
      root = mkdtempSync(path.join(tmpdir(), 'doc2conf-sec-'));
      docDir = path.join(root, 'repo', 'docs');
      outside = path.join(root, 'outside');
      mkdirSync(docDir, { recursive: true });
      mkdirSync(outside, { recursive: true });
      writeFileSync(path.join(docDir, 'ok.png'), 'png');
      writeFileSync(path.join(outside, 'secret.png'), 'secret');
      // Run "from the repo root" so cwd is not an accidental allow-all root.
      process.chdir(path.join(root, 'repo'));
    });

    afterEach(() => {
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    });

    const opts = { extensions: IMAGE_EXTENSIONS, kind: 'image' };

    it('allows files inside the document directory', () => {
      const resolved = resolveLocalAsset('ok.png', docDir, opts);
      assert.strictEqual(path.basename(resolved), 'ok.png');
    });

    it('rejects ../ traversal and absolute paths outside the allowed roots', () => {
      assert.throws(() => resolveLocalAsset('../../outside/secret.png', docDir, opts), /outside/);
      assert.throws(
        () => resolveLocalAsset(path.join(outside, 'secret.png'), docDir, opts),
        /outside/
      );
    });

    it('rejects symlinks that point outside the allowed roots', () => {
      symlinkSync(path.join(outside, 'secret.png'), path.join(docDir, 'link.png'));
      assert.throws(() => resolveLocalAsset('link.png', docDir, opts), /outside/);
    });

    it('rejects non-image files such as .env', () => {
      writeFileSync(path.join(docDir, '.env'), 'CONFLUENCE_API_TOKEN=x');
      assert.throws(() => resolveLocalAsset('.env', docDir, opts), /extension/);
    });
  });

  describe('storage format output', () => {
    const client = new ConfluenceClient(
      'https://confluence.example.com/confluence',
      { personalAccessToken: 'pat' },
      false,
      'server'
    );
    const toStorage = (content: unknown[]) =>
      (client as any).convertADFToStorage({ type: 'doc', version: 1, content });

    it('keeps code containing "]]>" inside its CDATA section', () => {
      const payload = ']]></ac:plain-text-body></ac:structured-macro><script>alert(1)</script>';
      const out = toStorage([{ type: 'codeBlock', content: [{ type: 'text', text: payload }] }]);
      assert.ok(!out.includes(']]></ac:plain-text-body></ac:structured-macro><script>'));
      assert.ok(out.includes(cdata(payload)));
    });

    it('escapes link hrefs and drops javascript: URLs', () => {
      const link = (href: string) =>
        toStorage([
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href } }] }],
          },
        ]);
      assert.ok(link('javascript:alert(1)').includes('<a href="#">'));
      assert.ok(link('https://a.example/"onmouseover="x').includes('&quot;onmouseover=&quot;'));
    });

    it('escapes attachment filenames and rejects bad colors and heading levels', () => {
      const out = toStorage([
        { type: 'media', attrs: { type: 'file', filename: 'a"/><script>.png' } },
        { type: 'heading', attrs: { level: '1><script' }, content: [{ type: 'text', text: 'h' }] },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'c',
              marks: [{ type: 'textColor', attrs: { color: 'red;background:url(x)' } }],
            },
          ],
        },
      ]);
      assert.ok(!out.includes('<script'));
      assert.ok(out.includes('<h1>h</h1>'));
      assert.ok(!out.includes('background'));
    });
  });

  describe('HTML macro', () => {
    it('sanitizes raw HTML before placing it in the macro body', async () => {
      const adf = await new Converter().convertToADF(
        '# T\n\n<img src=x onerror="alert(1)">\n\n<script>alert(2)</script>\n',
        { macroFormat: 'html' }
      );
      const html = (adf.content?.[0].content?.[0] as { text: string }).text;
      assert.ok(!html.includes('onerror'));
      assert.ok(!html.includes('<script'));
    });
  });

  describe('wiki image references', () => {
    it('ignores prose, URLs and non-image paths; strips |params', () => {
      const refs = findLocalWikiImageRefs(
        'Wow! see a/b and more! !img/a.png|width=300! !https://x.example/b.png! !../.env!'
      );
      assert.deepStrictEqual(refs, ['img/a.png']);
    });

    it('reports every failed upload and refuses paths outside the document directory', async () => {
      const client = new ConfluenceClient(
        'https://example.atlassian.net',
        { email: 'a@example.com', apiToken: 't' },
        false,
        'cloud'
      );
      const dir = mkdtempSync(path.join(tmpdir(), 'doc2conf-wiki-'));
      try {
        await assert.rejects(
          client.processWikiMarkupImages('!../../../../etc/x.png!', '1', dir),
          (error: unknown) =>
            error instanceof ImageUploadError &&
            error.failures.length === 1 &&
            /outside the document directory/.test(error.message)
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('input validation', () => {
    it('only accepts numeric content IDs', () => {
      assert.strictEqual(assertContentId('12345', 'page ID'), '12345');
      assert.strictEqual(assertContentId(undefined, 'page ID'), undefined);
      assert.throws(() => assertContentId('1/../../admin', 'page ID'), /numeric/);
    });

    it('refuses plain-HTTP Confluence URLs unless loopback or opted in', () => {
      const previous = process.env.CONFLUENCE_ALLOW_INSECURE_HTTP;
      delete process.env.CONFLUENCE_ALLOW_INSECURE_HTTP;
      try {
        assert.doesNotThrow(() => assertSecureUrl('https://x.atlassian.net/wiki'));
        assert.doesNotThrow(() => assertSecureUrl('http://localhost:8090'));
        assert.throws(() => assertSecureUrl('http://confluence.corp'), /plain HTTP/);
        process.env.CONFLUENCE_ALLOW_INSECURE_HTTP = 'true';
        assert.doesNotThrow(() => assertSecureUrl('http://confluence.corp'));
      } finally {
        if (previous === undefined) delete process.env.CONFLUENCE_ALLOW_INSECURE_HTTP;
        else process.env.CONFLUENCE_ALLOW_INSECURE_HTTP = previous;
      }
    });

    it('allows only safe link schemes', () => {
      assert.strictEqual(safeHref('https://a.example'), 'https://a.example');
      assert.strictEqual(safeHref('docs/page.md#x'), 'docs/page.md#x');
      assert.strictEqual(safeHref(' java\tscript:alert(1)'), '#');
      assert.strictEqual(safeHref('data:text/html,x'), '#');
    });
  });
});
