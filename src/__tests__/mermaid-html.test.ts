import assert from 'node:assert';
import { describe, it } from 'node:test';
import { convertMarkdownToWikiMarkup } from '../markdown-to-wiki';
import { generateMermaidUpgradeScript, generateMermaidUpgradeWikiMarkup } from '../mermaid-html';

describe('Mermaid Upgrade Script Generator', () => {
  describe('generateMermaidUpgradeScript', () => {
    it('should generate script with default options', () => {
      const script = generateMermaidUpgradeScript();

      // Check basic structure
      assert.match(script, /<script>/);
      assert.match(script, /<\/script>/);

      // Check that default CDN URL is used with version 11
      assert.match(script, /cdn\.jsdelivr\.net\/npm\/mermaid@11/);

      // Check that default theme is 'default'
      assert.match(script, /theme: 'default'/);

      // Check for upgrade logic
      assert.match(script, /upgradeMermaid/);
      assert.match(script, /mermaid\.initialize/);
      assert.match(script, /mermaid\.run/);
    });

    it('should use specified Mermaid version', () => {
      const script = generateMermaidUpgradeScript({ version: '10.9.0' });
      assert.match(script, /cdn\.jsdelivr\.net\/npm\/mermaid@10\.9\.0/);
    });

    it('should use specified theme', () => {
      const script = generateMermaidUpgradeScript({ theme: 'dark' });
      assert.match(script, /theme: 'dark'/);
    });

    it('should use forest theme', () => {
      const script = generateMermaidUpgradeScript({ theme: 'forest' });
      assert.match(script, /theme: 'forest'/);
    });

    it('should include custom config', () => {
      const script = generateMermaidUpgradeScript({
        config: {
          flowchart: { curve: 'basis' },
        },
      });
      assert.match(script, /flowchart/);
      assert.match(script, /curve/);
      assert.match(script, /basis/);
    });

    it('should use custom CDN URL when provided', () => {
      const customCdn = 'https://my-cdn.example.com/mermaid@{version}/mermaid.min.js';
      const script = generateMermaidUpgradeScript({
        cdnUrl: customCdn,
        version: '11',
      });

      assert.match(script, /my-cdn\.example\.com/);
    });

    it('should find all mermaid blocks on the page', () => {
      const script = generateMermaidUpgradeScript();
      // Check that it looks for various mermaid selectors
      assert.match(script, /pre\.mermaid/);
      assert.match(script, /code\.language-mermaid/);
      assert.match(script, /\.mermaid/);
    });
  });

  describe('generateMermaidUpgradeWikiMarkup', () => {
    it('should wrap script in {html} macro', () => {
      const wikiMarkup = generateMermaidUpgradeWikiMarkup();

      assert.match(wikiMarkup, /^\{html\}/);
      assert.match(wikiMarkup, /\{html\}$/);
      assert.match(wikiMarkup, /<script>/);
    });

    it('should pass options to script generator', () => {
      const wikiMarkup = generateMermaidUpgradeWikiMarkup({ theme: 'dark', version: '10' });

      assert.match(wikiMarkup, /theme: 'dark'/);
      assert.match(wikiMarkup, /mermaid@10/);
    });
  });
});

describe('Mermaid in Wiki Markup Conversion', () => {
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

      // Should NOT have upgrade script
      assert.doesNotMatch(result, /upgradeMermaid/);
    });

    it('should use {markdown} macro when mermaidFormat is native', () => {
      const result = convertMarkdownToWikiMarkup(mermaidMarkdown, {
        mermaidFormat: 'native',
      });

      assert.match(result, /\{markdown\}/);
      // Should NOT have upgrade script
      assert.doesNotMatch(result, /\{html\}[\s\S]*upgradeMermaid/);
    });
  });

  describe('HTML format (latest Mermaid via upgrade script)', () => {
    it('should keep {markdown} macro and append upgrade script', () => {
      const result = convertMarkdownToWikiMarkup(mermaidMarkdown, {
        mermaidFormat: 'html',
      });

      // Should still have mermaid in markdown macro
      assert.match(result, /\{markdown\}/);
      assert.match(result, /```mermaid/);

      // Should have upgrade script appended
      assert.match(result, /\{html\}/);
      assert.match(result, /upgradeMermaid/);
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

    it('should NOT append upgrade script if no mermaid blocks', () => {
      const noMermaidMarkdown = `# Test

Just regular content.

\`\`\`javascript
const x = 1;
\`\`\`
`;

      const result = convertMarkdownToWikiMarkup(noMermaidMarkdown, {
        mermaidFormat: 'html',
      });

      // Should NOT have upgrade script since there are no mermaid blocks
      assert.doesNotMatch(result, /upgradeMermaid/);
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

      // Mermaid should be in markdown macro
      assert.match(result, /\{markdown\}[\s\S]*mermaid[\s\S]*\{markdown\}/);

      // Upgrade script should be at the end
      assert.match(result, /upgradeMermaid/);
    });

    it('should handle multiple mermaid diagrams with single upgrade script', () => {
      const multiMermaidMarkdown = `# Test

\`\`\`mermaid
graph TD;
    A-->B;
\`\`\`

Some text.

\`\`\`mermaid
sequenceDiagram
    Alice->>Bob: Hello
\`\`\`
`;

      const result = convertMarkdownToWikiMarkup(multiMermaidMarkdown, {
        mermaidFormat: 'html',
      });

      // Should have both diagrams
      assert.match(result, /graph TD/);
      assert.match(result, /sequenceDiagram/);

      // Should only have ONE {html} macro at the end (for the upgrade script)
      // Count {html} occurrences - should be 2 (opening and closing)
      const htmlMacroMatches = result.match(/\{html\}/g);
      assert.strictEqual(
        htmlMacroMatches?.length,
        2,
        'Should have exactly one {html} macro (open+close)'
      );
    });
  });
});
