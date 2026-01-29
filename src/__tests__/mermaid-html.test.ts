import assert from 'node:assert';
import { describe, it } from 'node:test';
import { convertMarkdownToWikiMarkup } from '../markdown-to-wiki';
import { generateMermaidHtml, generateMermaidHtmlInline } from '../mermaid-html';

describe('Mermaid HTML Generator', () => {
  const sampleMermaidCode = `graph TD;
    A[Start] --> B[Process];
    B --> C[End];`;

  describe('generateMermaidHtml', () => {
    it('should generate HTML with default options', () => {
      const html = generateMermaidHtml(sampleMermaidCode);

      // Check basic structure
      assert.match(html, /<div class="mermaid-container"/);
      assert.match(html, /<pre class="mermaid">/);
      assert.match(html, /graph TD;/);

      // Check that default CDN URL is used with version 11
      assert.match(html, /cdn\.jsdelivr\.net\/npm\/mermaid@11/);

      // Check that default theme is 'default'
      assert.match(html, /theme: 'default'/);

      // Check loading state
      assert.match(html, /Loading diagram\.\.\./);
    });

    it('should use specified Mermaid version', () => {
      const html = generateMermaidHtml(sampleMermaidCode, { version: '10.9.0' });
      assert.match(html, /cdn\.jsdelivr\.net\/npm\/mermaid@10\.9\.0/);
    });

    it('should use specified theme', () => {
      const html = generateMermaidHtml(sampleMermaidCode, { theme: 'dark' });
      assert.match(html, /theme: 'dark'/);
    });

    it('should use forest theme', () => {
      const html = generateMermaidHtml(sampleMermaidCode, { theme: 'forest' });
      assert.match(html, /theme: 'forest'/);
    });

    it('should include custom config', () => {
      const html = generateMermaidHtml(sampleMermaidCode, {
        config: {
          flowchart: { curve: 'basis' },
        },
      });
      assert.match(html, /flowchart/);
      assert.match(html, /curve/);
      assert.match(html, /basis/);
    });

    it('should escape HTML entities in mermaid code', () => {
      const codeWithHtml = `graph TD;
    A["<script>alert('xss')</script>"] --> B;`;

      const html = generateMermaidHtml(codeWithHtml);

      // Check that script tags are escaped
      assert.match(html, /&lt;script&gt;/);
      assert.match(html, /&lt;\/script&gt;/);
      assert.doesNotMatch(html, /<script>alert/);
    });

    it('should generate unique container IDs', () => {
      const html1 = generateMermaidHtml(sampleMermaidCode);
      const html2 = generateMermaidHtml(sampleMermaidCode);

      // Extract IDs
      const idMatch1 = html1.match(/id="(mermaid-[^"]+)"/);
      const idMatch2 = html2.match(/id="(mermaid-[^"]+)"/);

      assert.ok(idMatch1, 'First HTML should have an ID');
      assert.ok(idMatch2, 'Second HTML should have an ID');
      assert.notStrictEqual(idMatch1[1], idMatch2[1], 'IDs should be different');
    });

    it('should handle script deduplication', () => {
      const html = generateMermaidHtml(sampleMermaidCode);

      // Check for deduplication mechanism
      assert.match(html, /window\._mermaidLoading/);
      assert.match(html, /window\._mermaidCallbacks/);
    });

    it('should use custom CDN URL when provided', () => {
      const customCdn = 'https://my-cdn.example.com/mermaid@{version}/mermaid.min.js';
      const html = generateMermaidHtml(sampleMermaidCode, {
        cdnUrl: customCdn,
        version: '11',
      });

      assert.match(html, /my-cdn\.example\.com/);
    });
  });

  describe('generateMermaidHtmlInline', () => {
    it('should generate minimal HTML without script', () => {
      const html = generateMermaidHtmlInline(sampleMermaidCode);

      // Check basic structure
      assert.match(html, /<div class="mermaid-container"/);
      assert.match(html, /<pre class="mermaid">/);
      assert.match(html, /graph TD;/);

      // Should NOT have script tags
      assert.doesNotMatch(html, /<script>/);
    });
  });
});

describe('Mermaid HTML in Wiki Markup Conversion', () => {
  const mermaidMarkdown = `# Test Document

Here is a diagram:

\`\`\`mermaid
graph TD;
    A-->B;
    B-->C;
\`\`\`

The end.`;

  describe('Native format (default)', () => {
    it('should use {markdown} macro for mermaid by default', () => {
      const result = convertMarkdownToWikiMarkup(mermaidMarkdown);

      // Should use native markdown macro format
      assert.match(result, /\{markdown\}/);
      assert.match(result, /```mermaid/);
      assert.match(result, /graph TD;/);
    });

    it('should use {markdown} macro when mermaidFormat is native', () => {
      const result = convertMarkdownToWikiMarkup(mermaidMarkdown, {
        mermaidFormat: 'native',
      });

      assert.match(result, /\{markdown\}/);
      assert.doesNotMatch(result, /\{html\}/);
    });
  });

  describe('HTML format (latest Mermaid)', () => {
    it('should use {html} macro when mermaidFormat is html', () => {
      const result = convertMarkdownToWikiMarkup(mermaidMarkdown, {
        mermaidFormat: 'html',
      });

      // Should use HTML macro
      assert.match(result, /\{html\}/);
      // Should NOT use markdown macro for mermaid
      assert.doesNotMatch(result, /\{markdown\}[\s\S]*mermaid/);

      // Should have mermaid container
      assert.match(result, /mermaid-container/);
      assert.match(result, /cdn\.jsdelivr\.net/);
    });

    it('should respect mermaidVersion option', () => {
      const result = convertMarkdownToWikiMarkup(mermaidMarkdown, {
        mermaidFormat: 'html',
        mermaidVersion: '10.9.0',
      });

      assert.match(result, /mermaid@10\.9\.0/);
    });

    it('should respect mermaidTheme option', () => {
      const result = convertMarkdownToWikiMarkup(mermaidMarkdown, {
        mermaidFormat: 'html',
        mermaidTheme: 'dark',
      });

      assert.match(result, /theme: 'dark'/);
    });

    it('should include custom mermaid config', () => {
      const result = convertMarkdownToWikiMarkup(mermaidMarkdown, {
        mermaidFormat: 'html',
        mermaidConfig: {
          flowchart: { curve: 'linear' },
        },
      });

      assert.match(result, /flowchart/);
      assert.match(result, /linear/);
    });
  });

  describe('Mixed content', () => {
    it('should convert non-mermaid code blocks normally', () => {
      const mixedMarkdown = `# Test

\`\`\`javascript
const x = 1;
\`\`\`

\`\`\`mermaid
graph TD;
    A-->B;
\`\`\`

\`\`\`python
print("hello")
\`\`\`
`;

      const result = convertMarkdownToWikiMarkup(mixedMarkdown, {
        mermaidFormat: 'html',
      });

      // JavaScript should use code macro
      assert.match(result, /\{code:javascript\}/);
      assert.match(result, /const x = 1;/);
      assert.match(result, /\{code\}/);

      // Python should use code macro
      assert.match(result, /\{code:python\}/);
      assert.match(result, /print\("hello"\)/);

      // Mermaid should use html macro
      assert.match(result, /\{html\}/);
      assert.match(result, /mermaid-container/);
    });
  });
});
