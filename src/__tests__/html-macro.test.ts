import assert from 'node:assert';
import { describe, it } from 'node:test';
import { Converter } from '../converter';

describe('HTML Macro', () => {
  const converter = new Converter();

  it('converts markdown to a document with an HTML macro', async () => {
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
    assert.strictEqual(adf.type, 'doc');
    assert.strictEqual(adf.version, 1);
    assert.strictEqual(adf.content?.length, 1);

    // Check that we have an extension node with the HTML macro
    const macroNode = adf.content?.[0];
    assert.strictEqual(macroNode?.type, 'extension');

    // Check extension attributes with type assertion
    const attrs = macroNode?.attrs as any;
    assert.strictEqual(attrs?.extensionType, 'com.atlassian.confluence.macro.core');
    assert.strictEqual(attrs?.extensionKey, 'html');
    assert.ok(attrs?.parameters?.macroParams !== undefined);

    // Check that the text node contains HTML (converted from markdown)
    const textNode = macroNode?.content?.[0];
    assert.strictEqual(textNode?.type, 'text');
    assert.ok(textNode?.text.includes('<h1'));
    assert.ok(textNode?.text.includes('<p>'));
    assert.ok(textNode?.text.includes('<strong>bold</strong>'));
    assert.ok(textNode?.text.includes('<em>italic</em>'));
    assert.ok(textNode?.text.includes('<ul>'));
    assert.ok(textNode?.text.includes('<li>'));
    assert.ok(textNode?.text.includes('<table>'));
    assert.ok(textNode?.text.includes('<blockquote>'));
  });

  it('converts markdown table with multi-line content', async () => {
    const markdown = `| Feature | Description |
| ------- | ----------- |
| Line 1 | This is a multi-line\ncell content |
| Line 2 | Another cell |
`;

    const adf = await converter.convertToADF(markdown, { macroFormat: 'html' });

    const macroNode = adf.content?.[0];
    const textNode = macroNode?.content?.[0];

    // Verify HTML table structure
    assert.ok(textNode?.text.includes('<table>'));
    assert.ok(textNode?.text.includes('<thead>'));
    assert.ok(textNode?.text.includes('<tbody>'));
    // Showdown adds IDs to headers when tablesHeaderId is enabled
    assert.ok(textNode?.text.includes('Feature</th>'));
    assert.ok(textNode?.text.includes('Description</th>'));
    assert.ok(textNode?.text.includes('<td>This is a multi-line'));
  });

  it('preserves task lists', async () => {
    const markdown = `# Tasks

- [ ] Task 1
- [x] Task 2 (completed)
- [ ] Task 3
`;

    const adf = await converter.convertToADF(markdown, { macroFormat: 'html' });

    const macroNode = adf.content?.[0];
    const textNode = macroNode?.content?.[0];

    // Verify task list structure in HTML
    assert.ok(textNode?.text.includes('<li'));
    assert.ok(textNode?.text.includes('type="checkbox"'));
  });

  it('preserves emoji', async () => {
    const markdown = `# Emoji Test

:smile: :heart: :rocket:
`;

    const adf = await converter.convertToADF(markdown, { macroFormat: 'html' });

    const macroNode = adf.content?.[0];
    const textNode = macroNode?.content?.[0];

    // Showdown with emoji option enabled converts :smile: to 😄
    assert.ok(textNode?.text.includes('😄'));
    assert.ok(textNode?.text.includes('❤️'));
    assert.ok(textNode?.text.includes('🚀'));
  });

  it('handles code blocks with syntax highlighting', async () => {
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
    assert.ok(textNode?.text.includes('<pre>'));
    assert.ok(textNode?.text.includes('<code'));
    assert.ok(textNode?.text.includes('typescript'));
  });
});
