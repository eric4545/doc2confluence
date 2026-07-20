import assert from 'node:assert';
import { describe, it } from 'node:test';
import { convertMarkdownToWikiMarkup } from '../markdown-to-wiki';
import { loadMarkdownFixture } from './test-helpers';

describe('Markdown to Wiki Markup Conversion', () => {
  describe('Headings', () => {
    it('should convert h1 heading', () => {
      const markdown = loadMarkdownFixture('headings/h1.md');
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'h1. Heading 1');
    });

    it('should convert h2 heading', () => {
      const markdown = loadMarkdownFixture('headings/h2.md');
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'h2. Heading 2');
    });

    it('should convert h3 heading', () => {
      const markdown = loadMarkdownFixture('headings/h3.md');
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'h3. Heading 3');
    });

    it('should convert heading with inline formatting', () => {
      const markdown = loadMarkdownFixture('headings/with-bold-text.md');
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'h1. Heading with *bold* text');
    });
  });

  describe('Paragraphs', () => {
    it('should convert simple paragraph', () => {
      const markdown = loadMarkdownFixture('paragraphs/simple.md');
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'This is a paragraph.');
    });

    it('should convert multiple paragraphs', () => {
      const markdown = loadMarkdownFixture('paragraphs/multiple.md');
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.match(result, /First paragraph\.\s+Second paragraph\./);
    });
  });

  describe('Inline Formatting', () => {
    it('should convert bold with **', () => {
      const markdown = loadMarkdownFixture('inline/bold-asterisk.md');
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'This is *bold* text.');
    });

    it('should convert bold with __', () => {
      const markdown = loadMarkdownFixture('inline/bold-underscore.md');
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'This is *bold* text.');
    });

    it('should convert italic', () => {
      const markdown = loadMarkdownFixture('inline/italic.md');
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'This is _italic_ text.');
    });

    it('should convert inline code', () => {
      const markdown = loadMarkdownFixture('inline/code.md');
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'This is {{code}} text.');
    });

    it('should convert strikethrough', () => {
      const markdown = loadMarkdownFixture('inline/strikethrough.md');
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'This is -strikethrough- text.');
    });
  });

  describe('Links and Images', () => {
    it('should convert markdown link', () => {
      const markdown = loadMarkdownFixture('links/link.md');
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'Check out [this link|https://example.com].');
    });

    it('should convert markdown image', () => {
      const markdown = loadMarkdownFixture('links/image.md');
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'Here is an image: !image.png!');
    });
  });

  describe('Literal Brackets', () => {
    it('should escape literal bracketed text so it is not treated as a wiki link', () => {
      const markdown = 'Circular view path [error] here';
      const result = convertMarkdownToWikiMarkup(markdown);
      // Brackets must be escaped so Confluence Server does not render a
      // broken page link (<ac:link><ri:page ri:content-title="error"/>).
      assert.strictEqual(result, 'Circular view path \\[error\\] here');
    });

    it('should not turn real markdown links into escaped brackets', () => {
      const markdown = 'Check out [docs](https://example.com).';
      const result = convertMarkdownToWikiMarkup(markdown);
      // Genuine links still use the pipe form and are left unescaped.
      assert.strictEqual(result, 'Check out [docs|https://example.com].');
    });

    it('should escape brackets in headings', () => {
      const markdown = '# Fix [error] path';
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'h1. Fix \\[error\\] path');
    });

    it('should escape brackets in table cells', () => {
      const markdown = ['| Header |', '| --- |', '| [error] |'].join('\n');
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.match(result, /\|\\\[error\\\]\|/);
    });
  });

  describe('Lists', () => {
    it('should convert unordered list', () => {
      const markdown = loadMarkdownFixture('lists/unordered.md');
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.match(result, /\* Item 1/);
      assert.match(result, /\* Item 2/);
      assert.match(result, /\* Item 3/);
    });

    it('should convert ordered list', () => {
      const markdown = loadMarkdownFixture('lists/ordered.md');
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.match(result, /# First/);
      assert.match(result, /# Second/);
      assert.match(result, /# Third/);
    });

    it('should convert nested list', () => {
      const markdown = loadMarkdownFixture('lists/nested.md');
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.match(result, /\* Item 1/);
      assert.match(result, /\*\* Nested 1/);
      assert.match(result, /\*\* Nested 2/);
      assert.match(result, /\* Item 2/);
    });
  });

  describe('Tables', () => {
    it('should convert simple table', () => {
      const markdown = loadMarkdownFixture('tables/simple.md');
      const result = convertMarkdownToWikiMarkup(markdown);

      // Check for wiki markup table syntax
      assert.match(result, /\|\|Header 1\|\|Header 2\|\|/);
      assert.match(result, /\|Cell 1\|Cell 2\|/);
      assert.match(result, /\|Cell 3\|Cell 4\|/);
    });

    it('should convert table with inline formatting', () => {
      const markdown = loadMarkdownFixture('tables/with-formatting.md');
      const result = convertMarkdownToWikiMarkup(markdown);

      assert.match(result, /\|\|Header\|\|Value\|\|/);
      assert.match(result, /\|\*Bold\*\|_Italic_\|/);
    });

    it('should convert table with multiple columns', () => {
      const markdown = loadMarkdownFixture('tables/multi-column.md');
      const result = convertMarkdownToWikiMarkup(markdown);

      assert.match(result, /\|\|Col1\|\|Col2\|\|Col3\|\|Col4\|\|/);
      assert.match(result, /\|A\|B\|C\|D\|/);
    });

    it('should convert br tags to newlines in table cells', () => {
      const markdown = loadMarkdownFixture('tables/with-br-tags.md');
      const result = convertMarkdownToWikiMarkup(markdown);

      // Check table structure is pure wiki markup
      assert.match(result, /\|\|Header 1\|\|Header 2\|\|/);
      // br tags should convert to actual newlines (pure text)
      assert.match(result, /\|Line 1\nLine 2\|Cell B\|/);
    });
  });

  describe('Code Blocks', () => {
    it('should convert code block with language', () => {
      const markdown = loadMarkdownFixture('code/javascript.md');
      const result = convertMarkdownToWikiMarkup(markdown);

      assert.match(result, /\{code:javascript\}/);
      assert.match(result, /const x = 1;/);
      assert.match(result, /\{code\}/);
    });

    it('should convert code block without language', () => {
      const markdown = loadMarkdownFixture('code/no-lang.md');
      const result = convertMarkdownToWikiMarkup(markdown);

      assert.match(result, /\{code:none\}/);
      assert.match(result, /plain text/);
      assert.match(result, /\{code\}/);
    });

    it('should convert mermaid diagram', () => {
      const markdown = loadMarkdownFixture('code/mermaid.md');
      const result = convertMarkdownToWikiMarkup(markdown);

      // Mermaid diagrams should be wrapped in {markdown} macro, not {mermaid}
      assert.match(result, /\{markdown\}/);
      assert.match(result, /```mermaid/);
      assert.match(result, /graph TD;/);
      assert.match(result, /A-->B;/);
    });
  });

  describe('Blockquotes', () => {
    it('should convert blockquote', () => {
      const markdown = loadMarkdownFixture('blockquote.md');
      const result = convertMarkdownToWikiMarkup(markdown);

      assert.match(result, /\{quote\}/);
      assert.match(result, /This is a quote/);
    });
  });

  describe('Horizontal Rule', () => {
    it('should convert horizontal rule', () => {
      const markdown = loadMarkdownFixture('horizontal-rule.md');
      const result = convertMarkdownToWikiMarkup(markdown);

      assert.match(result, /----/);
    });
  });

  describe('Complex Document', () => {
    it('should convert a complex document with mixed elements', () => {
      const markdown = loadMarkdownFixture('complex-document.md');
      const result = convertMarkdownToWikiMarkup(markdown);

      // Verify key elements are converted
      assert.match(result, /h1\. Release Notes/);
      assert.match(result, /h2\. Overview/);
      assert.match(result, /\*important\*/);
      assert.match(result, /\* Feature 1/);
      assert.match(result, /\[link\|https:\/\/example\.com\]/);
      assert.match(result, /\|\|Component\|\|Status\|\|Notes\|\|/);
      assert.match(result, /\{code:javascript\}/);
      assert.match(result, /\{quote\}/);
    });
  });

  describe('YAML Frontmatter', () => {
    it('should strip YAML frontmatter from markdown', () => {
      const markdown = loadMarkdownFixture('yaml-frontmatter.md');
      const result = convertMarkdownToWikiMarkup(markdown);

      // Should not contain YAML frontmatter
      assert.doesNotMatch(result, /title: My Document/);
      assert.doesNotMatch(result, /author: John Doe/);
      assert.doesNotMatch(result, /tags:/);

      // Should contain the actual content
      assert.match(result, /h1\. Heading/);
      assert.match(result, /This is content\./);
    });

    it('should handle markdown without YAML frontmatter', () => {
      const markdown = loadMarkdownFixture('yaml-no-frontmatter.md');
      const result = convertMarkdownToWikiMarkup(markdown);

      // Should work normally
      assert.match(result, /h1\. Heading/);
      assert.match(result, /This is content without frontmatter\./);
    });
  });
});
