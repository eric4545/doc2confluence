import { parseMarkdownFile } from '../metadata';

describe('Metadata Parser', () => {
  test('parses YAML front matter with useMarkdownMacro option', () => {
    const markdown = `---
title: "Test Document"
space: "TEST"
parentId: "12345"
labels:
  - test
  - example
useMarkdownMacro: true
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
    expect(metadata.useMarkdownMacro).toBe(true);

    // Check that the content was parsed correctly (without front matter)
    expect(content.trim().startsWith('# Test Content')).toBe(true);
  });

  test('uses default value (false) for useMarkdownMacro when not specified', () => {
    const markdown = `---
title: "Test Document"
space: "TEST"
---

# Test Content
`;

    const { metadata } = parseMarkdownFile(markdown);
    expect(metadata.useMarkdownMacro).toBe(false);
  });
});
