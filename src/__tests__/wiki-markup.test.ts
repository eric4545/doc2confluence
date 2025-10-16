import assert from 'node:assert';
import { describe, it } from 'node:test';
import { convertMarkdownToWikiMarkup } from '../markdown-to-wiki';

describe('Markdown to Wiki Markup Conversion', () => {
  describe('Headings', () => {
    it('should convert h1 heading', () => {
      const markdown = '# Heading 1';
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'h1. Heading 1');
    });

    it('should convert h2 heading', () => {
      const markdown = '## Heading 2';
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'h2. Heading 2');
    });

    it('should convert h3 heading', () => {
      const markdown = '### Heading 3';
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'h3. Heading 3');
    });

    it('should convert heading with inline formatting', () => {
      const markdown = '# Heading with **bold** text';
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'h1. Heading with *bold* text');
    });
  });

  describe('Paragraphs', () => {
    it('should convert simple paragraph', () => {
      const markdown = 'This is a paragraph.';
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'This is a paragraph.');
    });

    it('should convert multiple paragraphs', () => {
      const markdown = 'First paragraph.\n\nSecond paragraph.';
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.match(result, /First paragraph\.\s+Second paragraph\./);
    });
  });

  describe('Inline Formatting', () => {
    it('should convert bold with **', () => {
      const markdown = 'This is **bold** text.';
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'This is *bold* text.');
    });

    it('should convert bold with __', () => {
      const markdown = 'This is __bold__ text.';
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'This is *bold* text.');
    });

    it('should convert italic', () => {
      const markdown = 'This is *italic* text.';
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'This is _italic_ text.');
    });

    it('should convert inline code', () => {
      const markdown = 'This is `code` text.';
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'This is {{code}} text.');
    });

    it('should convert strikethrough', () => {
      const markdown = 'This is ~~strikethrough~~ text.';
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'This is -strikethrough- text.');
    });
  });

  describe('Links and Images', () => {
    it('should convert markdown link', () => {
      const markdown = 'Check out [this link](https://example.com).';
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'Check out [this link|https://example.com].');
    });

    it('should convert markdown image', () => {
      const markdown = 'Here is an image: ![alt text](image.png)';
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.strictEqual(result, 'Here is an image: !image.png!');
    });
  });

  describe('Lists', () => {
    it('should convert unordered list', () => {
      const markdown = `- Item 1
- Item 2
- Item 3`;
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.match(result, /\* Item 1/);
      assert.match(result, /\* Item 2/);
      assert.match(result, /\* Item 3/);
    });

    it('should convert ordered list', () => {
      const markdown = `1. First
2. Second
3. Third`;
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.match(result, /# First/);
      assert.match(result, /# Second/);
      assert.match(result, /# Third/);
    });

    it('should convert nested list', () => {
      const markdown = `- Item 1
  - Nested 1
  - Nested 2
- Item 2`;
      const result = convertMarkdownToWikiMarkup(markdown);
      assert.match(result, /\* Item 1/);
      assert.match(result, /\*\* Nested 1/);
      assert.match(result, /\*\* Nested 2/);
      assert.match(result, /\* Item 2/);
    });
  });

  describe('Tables', () => {
    it('should convert simple table', () => {
      const markdown = `| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
| Cell 3   | Cell 4   |`;
      const result = convertMarkdownToWikiMarkup(markdown);

      // Check for wiki markup table syntax
      assert.match(result, /\|\|Header 1\|\|Header 2\|\|/);
      assert.match(result, /\|Cell 1\|Cell 2\|/);
      assert.match(result, /\|Cell 3\|Cell 4\|/);
    });

    it('should convert table with inline formatting', () => {
      const markdown = `| Header | Value |
|--------|-------|
| **Bold** | *Italic* |`;
      const result = convertMarkdownToWikiMarkup(markdown);

      assert.match(result, /\|\|Header\|\|Value\|\|/);
      assert.match(result, /\|\*Bold\*\|_Italic_\|/);
    });

    it('should convert table with multiple columns', () => {
      const markdown = `| Col1 | Col2 | Col3 | Col4 |
|------|------|------|------|
| A    | B    | C    | D    |`;
      const result = convertMarkdownToWikiMarkup(markdown);

      assert.match(result, /\|\|Col1\|\|Col2\|\|Col3\|\|Col4\|\|/);
      assert.match(result, /\|A\|B\|C\|D\|/);
    });

    it('should convert br tags to newlines in table cells', () => {
      const markdown = `| Header 1 | Header 2 |
|----------|----------|
| Line 1<br>Line 2 | Cell B |`;
      const result = convertMarkdownToWikiMarkup(markdown);

      // Check table structure is pure wiki markup
      assert.match(result, /\|\|Header 1\|\|Header 2\|\|/);
      // br tags should convert to actual newlines (pure text)
      assert.match(result, /\|Line 1\nLine 2\|Cell B\|/);
    });
  });

  describe('Code Blocks', () => {
    it('should convert code block with language', () => {
      const markdown = '```javascript\nconst x = 1;\n```';
      const result = convertMarkdownToWikiMarkup(markdown);

      assert.match(result, /\{code:javascript\}/);
      assert.match(result, /const x = 1;/);
      assert.match(result, /\{code\}/);
    });

    it('should convert code block without language', () => {
      const markdown = '```\nplain text\n```';
      const result = convertMarkdownToWikiMarkup(markdown);

      assert.match(result, /\{code:none\}/);
      assert.match(result, /plain text/);
      assert.match(result, /\{code\}/);
    });

    it('should convert mermaid diagram', () => {
      const markdown = '```mermaid\ngraph TD;\n  A-->B;\n```';
      const result = convertMarkdownToWikiMarkup(markdown);

      assert.match(result, /\{mermaid\}/);
      assert.match(result, /graph TD;/);
      assert.match(result, /A-->B;/);
    });
  });

  describe('Blockquotes', () => {
    it('should convert blockquote', () => {
      const markdown = '> This is a quote';
      const result = convertMarkdownToWikiMarkup(markdown);

      assert.match(result, /\{quote\}/);
      assert.match(result, /This is a quote/);
    });
  });

  describe('Horizontal Rule', () => {
    it('should convert horizontal rule', () => {
      const markdown = 'Text before\n\n---\n\nText after';
      const result = convertMarkdownToWikiMarkup(markdown);

      assert.match(result, /----/);
    });
  });

  describe('Complex Document', () => {
    it('should convert a complex document with mixed elements', () => {
      const markdown = `# Release Notes

## Overview

This release includes **important** updates.

### Features

- Feature 1
- Feature 2 with [link](https://example.com)

### Changes

| Component | Status | Notes |
|-----------|--------|-------|
| API       | **Updated** | See docs |
| UI        | *New* | Redesigned |

\`\`\`javascript
const version = '1.0.0';
\`\`\`

> Remember to test thoroughly!`;

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
});
