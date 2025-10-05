import { parseMarkdownFile } from '../metadata';

describe('Metadata Parser', () => {
  test('parses YAML front matter with macroFormat option', () => {
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
    expect(metadata.title).toBe('Test Document');
    expect(metadata.space).toBe('TEST');
    expect(metadata.parentId).toBe('12345');
    expect(metadata.labels).toEqual(['test', 'example']);
    expect(metadata.macroFormat).toBe('markdown');

    // Check that the content was parsed correctly (without front matter)
    expect(content.trim().startsWith('# Test Content')).toBe(true);
  });

  test('parses macroFormat html option', () => {
    const markdown = `---
title: "Test Document"
macroFormat: html
---

# Test Content
`;

    const { metadata } = parseMarkdownFile(markdown);
    expect(metadata.macroFormat).toBe('html');
  });

  test('uses undefined for macroFormat when not specified', () => {
    const markdown = `---
title: "Test Document"
space: "TEST"
---

# Test Content
`;

    const { metadata } = parseMarkdownFile(markdown);
    expect(metadata.macroFormat).toBeUndefined();
  });

  test('supports legacy useMarkdownMacro for backward compatibility', () => {
    const markdown = `---
title: "Test Document"
useMarkdownMacro: true
---

# Test Content
`;

    const { metadata } = parseMarkdownFile(markdown);
    expect(metadata.macroFormat).toBe('markdown');
  });

  test('supports legacy useHtmlMacro for backward compatibility', () => {
    const markdown = `---
title: "Test Document"
useHtmlMacro: true
---

# Test Content
`;

    const { metadata } = parseMarkdownFile(markdown);
    expect(metadata.macroFormat).toBe('html');
  });
});
