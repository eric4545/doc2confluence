import assert from 'node:assert';
import { describe, it } from 'node:test';
import { Converter } from '../converter';

describe('Markdown Macro', () => {
  const converter = new Converter();

  it('converts markdown to a document with a markdown macro', async () => {
    const markdown = `# Test Heading

This is a test paragraph.

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

    const adf = await converter.convertToADF(markdown, { macroFormat: 'markdown' });

    // Check the ADF structure
    assert.strictEqual(adf.type, 'doc');
    assert.strictEqual(adf.version, 1);
    assert.strictEqual(adf.content?.length, 1);

    // Check that we have an extension node with the markdown macro
    const macroNode = adf.content?.[0];
    assert.strictEqual(macroNode?.type, 'extension');

    // Check extension attributes with type assertion
    const attrs = macroNode?.attrs as any;
    assert.strictEqual(attrs?.extensionType, 'com.atlassian.confluence.macro.core');
    assert.strictEqual(attrs?.extensionKey, 'markdown');
    assert.ok(attrs?.parameters?.macroParams !== undefined);

    // Check that the text node contains the original markdown
    const textNode = macroNode?.content?.[0];
    assert.strictEqual(textNode?.type, 'text');
    assert.strictEqual(textNode?.text, markdown.trim());
  });
});
