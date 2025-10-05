import { Converter } from '../converter';

describe('HTML Macro', () => {
  const converter = new Converter();

  test('converts markdown to a document with an HTML macro', async () => {
    const markdown = `# Test Heading

This is a test paragraph with **bold** and *italic* text.

- List item 1
- List item 2

\`\`\`javascript
function test() {
  console.log('Hello, world!');
}
\`\`\`

> This is a blockquote.

| Column 1 | Column 2 |
| -------- | -------- |
| Value 1  | Value 2  |
`;

    const adf = await converter.convertToADF(markdown, { macroFormat: 'html' });

    // Check the ADF structure
    expect(adf.type).toBe('doc');
    expect(adf.version).toBe(1);
    expect(adf.content?.length).toBe(1);

    // Check that we have an extension node with the HTML macro
    const macroNode = adf.content?.[0];
    expect(macroNode?.type).toBe('extension');

    // Check extension attributes with type assertion
    const attrs = macroNode?.attrs as any;
    expect(attrs?.extensionType).toBe('com.atlassian.confluence.macro.core');
    expect(attrs?.extensionKey).toBe('html');
    expect(attrs?.parameters?.macroParams).toBeDefined();

    // Check that the text node contains HTML (converted from markdown)
    const textNode = macroNode?.content?.[0];
    expect(textNode?.type).toBe('text');
    expect(textNode?.text).toContain('<h1');
    expect(textNode?.text).toContain('<p>');
    expect(textNode?.text).toContain('<strong>bold</strong>');
    expect(textNode?.text).toContain('<em>italic</em>');
    expect(textNode?.text).toContain('<ul>');
    expect(textNode?.text).toContain('<li>');
    expect(textNode?.text).toContain('<table>');
    expect(textNode?.text).toContain('<blockquote>');
  });

  test('converts markdown table with multi-line content', async () => {
    const markdown = `| Feature | Description |
| ------- | ----------- |
| Line 1 | This is a multi-line\ncell content |
| Line 2 | Another cell |
`;

    const adf = await converter.convertToADF(markdown, { macroFormat: 'html' });

    const macroNode = adf.content?.[0];
    const textNode = macroNode?.content?.[0];

    // Verify HTML table structure
    expect(textNode?.text).toContain('<table>');
    expect(textNode?.text).toContain('<thead>');
    expect(textNode?.text).toContain('<tbody>');
    // Showdown adds IDs to headers when tablesHeaderId is enabled
    expect(textNode?.text).toContain('Feature</th>');
    expect(textNode?.text).toContain('Description</th>');
    expect(textNode?.text).toContain('<td>This is a multi-line');
  });

  test('preserves task lists', async () => {
    const markdown = `# Tasks

- [ ] Task 1
- [x] Task 2 (completed)
- [ ] Task 3
`;

    const adf = await converter.convertToADF(markdown, { macroFormat: 'html' });

    const macroNode = adf.content?.[0];
    const textNode = macroNode?.content?.[0];

    // Verify task list structure in HTML
    expect(textNode?.text).toContain('<li');
    expect(textNode?.text).toContain('type="checkbox"');
  });

  test('preserves emoji', async () => {
    const markdown = `# Emoji Test

:smile: :heart: :rocket:
`;

    const adf = await converter.convertToADF(markdown, { macroFormat: 'html' });

    const macroNode = adf.content?.[0];
    const textNode = macroNode?.content?.[0];

    // Showdown with emoji option enabled converts :smile: to 😄
    expect(textNode?.text).toContain('😄');
    expect(textNode?.text).toContain('❤️');
    expect(textNode?.text).toContain('🚀');
  });

  test('handles code blocks with syntax highlighting', async () => {
    const markdown = `\`\`\`typescript
interface User {
  name: string;
  age: number;
}
\`\`\``;

    const adf = await converter.convertToADF(markdown, { macroFormat: 'html' });

    const macroNode = adf.content?.[0];
    const textNode = macroNode?.content?.[0];

    // Verify code block structure
    expect(textNode?.text).toContain('<pre>');
    expect(textNode?.text).toContain('<code');
    expect(textNode?.text).toContain('typescript');
  });
});
