import { Converter } from '../converter';

describe('Markdown Macro', () => {
  const converter = new Converter();

  test('converts markdown to a document with a markdown macro', async () => {
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

    const adf = await converter.convertToADF(markdown, { useMarkdownMacro: true });

    // Check the ADF structure
    expect(adf.type).toBe('doc');
    expect(adf.version).toBe(1);
    expect(adf.content?.length).toBe(1);

    // Check that we have an extension node with the markdown macro
    const macroNode = adf.content?.[0];
    expect(macroNode?.type).toBe('extension');

    // Check extension attributes with type assertion
    const attrs = macroNode?.attrs as any;
    expect(attrs?.extensionType).toBe('com.atlassian.confluence.macro.core');
    expect(attrs?.extensionKey).toBe('markdown');
    expect(attrs?.parameters?.macroParams).toBeDefined();

    // Check that the text node contains the original markdown
    const textNode = macroNode?.content?.[0];
    expect(textNode?.type).toBe('text');
    expect(textNode?.text).toBe(markdown.trim());
  });
});
