import * as marked from 'marked';
import { generateMermaidHtml, type MermaidHtmlOptions, type MermaidTheme } from './mermaid-html';

/**
 * Options for wiki markup conversion
 */
export interface WikiMarkupConversionOptions {
  /**
   * Mermaid diagram rendering format:
   * - 'native': Use Confluence's built-in rendering via {markdown} macro (default)
   * - 'html': Use HTML macro with CDN-loaded latest Mermaid.js
   */
  mermaidFormat?: 'native' | 'html';
  /** Mermaid.js version for CDN (only used when mermaidFormat='html'). Default: '11' */
  mermaidVersion?: string;
  /** Mermaid theme (only used when mermaidFormat='html'). Default: 'default' */
  mermaidTheme?: MermaidTheme;
  /** Custom Mermaid configuration object (only used when mermaidFormat='html') */
  mermaidConfig?: Record<string, unknown>;
}

/**
 * Removes YAML frontmatter from markdown content
 * YAML frontmatter is typically delimited by --- at the start and end
 * @param markdown The markdown content with potential YAML frontmatter
 * @returns The markdown content without YAML frontmatter
 */
function stripYamlFrontmatter(markdown: string): string {
  // Match YAML frontmatter pattern: starts with ---, ends with ---
  const yamlFrontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
  return markdown.replace(yamlFrontmatterRegex, '');
}

/**
 * Fixes malformed mermaid blocks that have {code:none} or {code} tags injected
 * This can happen when the markdown parser incorrectly splits a mermaid code block
 * @param wikiMarkup The wiki markup to fix
 * @returns The fixed wiki markup
 */
function fixMalformedMermaidBlocks(wikiMarkup: string): string {
  // Pattern: {markdown}...{code:none}...{code}...{code:none}...{markdown}
  // We want to remove the {code:none} and {code} tags that appear between {markdown} tags

  // Find all occurrences of {markdown}...{markdown} blocks
  const mermaidBlockRegex = /\{markdown\}([\s\S]*?)\{markdown\}/g;

  return wikiMarkup.replace(mermaidBlockRegex, (_match, content) => {
    // Remove any {code:none}, {code:...}, or {code} tags from within the mermaid block
    const cleaned = content
      .replace(/\{code:none\}/g, '')
      .replace(/\{code:[^}]+\}/g, '')
      .replace(/\{code\}/g, '');

    return `{markdown}${cleaned}{markdown}`;
  });
}

// Store options globally for use in nested functions
let _conversionOptions: WikiMarkupConversionOptions = {};

/**
 * Converts Markdown content to Confluence Wiki Markup format
 * Strategy: Use {markdown} blocks for most content to let Confluence render natively,
 * only convert structural elements that require specific Confluence wiki syntax
 * @param markdown The markdown content to convert
 * @param options Optional conversion options (e.g., mermaid format)
 * @returns The converted Wiki Markup content
 */
export function convertMarkdownToWikiMarkup(
  markdown: string,
  options: WikiMarkupConversionOptions = {}
): string {
  // Store options for use in nested functions
  _conversionOptions = options;

  // Strip YAML frontmatter if present (hide metadata in Confluence)
  const cleanMarkdown = stripYamlFrontmatter(markdown);

  // Parse markdown into tokens with options to preserve code blocks
  const tokens = marked.lexer(cleanMarkdown, {
    gfm: true,
    breaks: false,
    pedantic: false,
  });

  // Convert tokens to Wiki Markup
  const result = processTokens(tokens);

  // Post-process to fix malformed mermaid blocks with {code:none} injections
  // (only for native format, html format uses {html} macro)
  if (options.mermaidFormat !== 'html') {
    return fixMalformedMermaidBlocks(result);
  }
  return result;
}

/**
 * Process an array of marked tokens and convert to Wiki Markup
 */
function processTokens(tokens: marked.Token[]): string {
  let result = '';

  for (const token of tokens) {
    result += convertToken(token);
  }

  return result.trim();
}

/**
 * Convert a single marked token to Wiki Markup
 */
function convertToken(token: marked.Token): string {
  switch (token.type) {
    case 'heading':
      return convertHeading(token as marked.Tokens.Heading);

    case 'paragraph':
      return convertParagraph(token as marked.Tokens.Paragraph);

    case 'list':
      return convertList(token as marked.Tokens.List);

    case 'table':
      return convertTable(token as marked.Tokens.Table);

    case 'code':
      return convertCodeBlock(token as marked.Tokens.Code);

    case 'blockquote':
      return convertBlockquote(token as marked.Tokens.Blockquote);

    case 'hr':
      return '----\n\n';

    case 'space':
      return '\n';

    default:
      // For unknown types, try to get raw text
      if ('text' in token && typeof token.text === 'string') {
        return `${token.text}\n\n`;
      }
      return '';
  }
}

/**
 * Process inline tokens (for bold, italic, links, etc.)
 * Converts markdown inline elements to Confluence wiki markup
 */
function processInlineTokens(tokens: marked.Token[]): string {
  let result = '';

  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        result += replaceEmojis((token as marked.Tokens.Text).text);
        break;
      case 'strong':
        result += `*${processInlineTokens((token as marked.Tokens.Strong).tokens || [])}*`;
        break;
      case 'em':
        result += `_${processInlineTokens((token as marked.Tokens.Em).tokens || [])}_`;
        break;
      case 'codespan':
        result += `{{${(token as marked.Tokens.Codespan).text}}}`;
        break;
      case 'link': {
        const linkToken = token as marked.Tokens.Link;
        const linkText = linkToken.tokens ? processInlineTokens(linkToken.tokens) : linkToken.text;
        result += `[${linkText}|${linkToken.href}]`;
        break;
      }
      case 'image': {
        const imgToken = token as marked.Tokens.Image;
        result += `!${imgToken.href}!`;
        break;
      }
      case 'del':
        result += `-${processInlineTokens((token as marked.Tokens.Del).tokens || [])}-`;
        break;
      case 'html': {
        // Convert HTML br tags to newlines
        const htmlToken = token as marked.Tokens.HTML;
        result += htmlToken.text.replace(/<br\s*\/?>/gi, '\n');
        break;
      }
      case 'br':
        // Handle line breaks
        result += '\n';
        break;
      default:
        // Fallback to text property if available
        if ('text' in token && typeof token.text === 'string') {
          result += replaceEmojis(token.text);
        }
    }
  }

  return result;
}

/**
 * Convert heading token to Wiki Markup
 * Markdown: # Heading → Wiki: h1. Heading
 */
function convertHeading(token: marked.Tokens.Heading): string {
  const level = token.depth;
  const text = token.tokens ? processInlineTokens(token.tokens) : token.text;
  return `h${level}. ${text}\n\n`;
}

/**
 * Convert paragraph token to Wiki Markup
 * For paragraphs with complex formatting, we convert inline elements
 */
function convertParagraph(token: marked.Tokens.Paragraph): string {
  const text = token.tokens ? processInlineTokens(token.tokens) : token.text;
  return `${text}\n\n`;
}

/**
 * Convert list token to Wiki Markup
 * Markdown: - item → Wiki: * item
 * Markdown: 1. item → Wiki: # item
 */
function convertList(token: marked.Tokens.List, depth = 0): string {
  const items = token.items;
  let result = '';

  for (const item of items) {
    const prefix = token.ordered ? '#' : '*';
    const indent = prefix.repeat(depth + 1);

    // Get the text content, handling nested lists
    let itemText = '';
    if (item.tokens) {
      for (const subToken of item.tokens) {
        if (subToken.type === 'text') {
          const textToken = subToken as marked.Tokens.Text;
          itemText += textToken.tokens ? processInlineTokens(textToken.tokens) : textToken.text;
        } else if (subToken.type === 'paragraph') {
          const paraToken = subToken as marked.Tokens.Paragraph;
          itemText += paraToken.tokens ? processInlineTokens(paraToken.tokens) : paraToken.text;
        } else if (subToken.type === 'list') {
          // Handle nested list
          if (itemText) {
            result += `${indent} ${itemText}\n`;
            itemText = '';
          }
          result += convertList(subToken as marked.Tokens.List, depth + 1);
        } else if ('text' in subToken && typeof subToken.text === 'string') {
          itemText += subToken.text;
        }
      }
    } else {
      itemText = item.text;
    }

    if (itemText) {
      result += `${indent} ${itemText.trim()}\n`;
    }
  }

  return `${result}\n`;
}

/**
 * Convert table token to Wiki Markup
 * Markdown: | Header | → Wiki: ||Header||
 * Markdown: | Cell | → Wiki: |Cell|
 */
function convertTable(token: marked.Tokens.Table): string {
  let result = '';

  // Helper to process content for table cells
  const processCellContent = (text: string): string => {
    // Preserve newlines in table cells - Confluence handles them correctly
    // Just trim excess whitespace
    return text.trim();
  };

  // Convert header row
  if (token.header.length > 0) {
    const headers = token.header.map((cell) => {
      const text = cell.tokens ? processInlineTokens(cell.tokens) : cell.text;
      return processCellContent(text);
    });
    result += `||${headers.join('||')}||\n`;
  }

  // Convert data rows
  for (const row of token.rows) {
    const cells = row.map((cell) => {
      const text = cell.tokens ? processInlineTokens(cell.tokens) : cell.text;
      return processCellContent(text);
    });
    result += `|${cells.join('|')}|\n`;
  }

  return `${result}\n`;
}

/**
 * Convert code block to Wiki Markup
 * Markdown: ```lang ... ``` → Wiki: {code:lang}...{code}
 * Special case: mermaid diagrams use {markdown} wrapper (or {html} with latest version)
 */
function convertCodeBlock(token: marked.Tokens.Code): string {
  const lang = token.lang || 'none';
  const code = token.text;

  // Special handling for mermaid diagrams
  if (lang === 'mermaid') {
    // Check if HTML format is requested for latest Mermaid.js
    if (_conversionOptions.mermaidFormat === 'html') {
      const mermaidHtmlOptions: MermaidHtmlOptions = {
        version: _conversionOptions.mermaidVersion,
        theme: _conversionOptions.mermaidTheme,
        config: _conversionOptions.mermaidConfig,
      };
      const html = generateMermaidHtml(code, mermaidHtmlOptions);
      return `{html}\n${html}\n{html}\n\n`;
    }

    // Default: wrap in {markdown} macro (uses Confluence's built-in old Mermaid)
    return `{markdown}\n\`\`\`mermaid\n${code}\n\`\`\`\n{markdown}\n\n`;
  }

  return `{code:${lang}}\n${code}\n{code}\n\n`;
}

/**
 * Convert blockquote to Wiki Markup
 * Markdown: > text → Wiki: {quote}text{quote}
 */
function convertBlockquote(token: marked.Tokens.Blockquote): string {
  let text = '';
  for (const subToken of token.tokens) {
    if (subToken.type === 'paragraph') {
      const paraToken = subToken as marked.Tokens.Paragraph;
      text += paraToken.tokens ? processInlineTokens(paraToken.tokens) : paraToken.text;
    } else if ('text' in subToken && typeof subToken.text === 'string') {
      text += subToken.text;
    }
  }
  return `{quote}\n${text.trim()}\n{quote}\n\n`;
}

/**
 * Helper function to replace Unicode emojis with Confluence emoticons
 * Confluence emoticons are more reliable than Unicode emojis
 */
function replaceEmojis(text: string): string {
  const emojiMap: Record<string, string> = {
    '✅': '(/)',
    '❌': '(x)',
    '⚠️': '(!)',
    '⚠': '(!)',
    ℹ️: '(i)',
    ℹ: '(i)',
    '⭐': '(*)',
    '👤': '(i)',
    '⏱️': '(time)',
    '⏱': '(time)',
    '📋': '(-)',
    '🎫': '(flag)',
    '🔀': '(?)',
  };

  let result = text;
  for (const [emoji, emoticon] of Object.entries(emojiMap)) {
    result = result.replace(new RegExp(emoji, 'g'), emoticon);
  }
  return result;
}
