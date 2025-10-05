import assert from 'node:assert';
import { describe, it } from 'node:test';
import { parseMarkdownFile } from '../metadata';

describe('Metadata Parser', () => {
  it('parses YAML front matter with macroFormat option', () => {
    const markdown = `---
title: "Test Document"
space: "TEST"
parentId: "12345"
labels:
  - test
  - example
macroFormat: markdown
---

# Test Content

This is test content.
`;

    const { content, metadata } = parseMarkdownFile(markdown);

    // Check that the metadata was parsed correctly
    assert.strictEqual(metadata.title, 'Test Document');
    assert.strictEqual(metadata.space, 'TEST');
    assert.strictEqual(metadata.parentId, '12345');
    assert.deepStrictEqual(metadata.labels, ['test', 'example']);
    assert.strictEqual(metadata.macroFormat, 'markdown');

    // Check that the content was parsed correctly (without front matter)
    assert.ok(content.trim().startsWith('# Test Content'));
  });

  it('parses macroFormat html option', () => {
    const markdown = `---
title: "Test Document"
macroFormat: html
---

# Test Content
`;

    const { metadata } = parseMarkdownFile(markdown);
    assert.strictEqual(metadata.macroFormat, 'html');
  });

  it('uses undefined for macroFormat when not specified', () => {
    const markdown = `---
title: "Test Document"
space: "TEST"
---

# Test Content
`;

    const { metadata } = parseMarkdownFile(markdown);
    assert.strictEqual(metadata.macroFormat, undefined);
  });

  it('supports legacy useMarkdownMacro for backward compatibility', () => {
    const markdown = `---
title: "Test Document"
useMarkdownMacro: true
---

# Test Content
`;

    const { metadata } = parseMarkdownFile(markdown);
    assert.strictEqual(metadata.macroFormat, 'markdown');
  });

  it('supports legacy useHtmlMacro for backward compatibility', () => {
    const markdown = `---
title: "Test Document"
useHtmlMacro: true
---

# Test Content
`;

    const { metadata } = parseMarkdownFile(markdown);
    assert.strictEqual(metadata.macroFormat, 'html');
  });
});
