import * as marked from 'marked';

/**
 * Converts Markdown content to Confluence Wiki Markup format
 * @param markdown The markdown content to convert
 * @returns The converted Wiki Markup content
 */
export function convertMarkdownToWikiMarkup(markdown: string): string {
  // Parse markdown into tokens
  const tokens = marked.lexer(markdown);

  // Convert tokens to Wiki Markup
  return processTokens(tokens);
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
        return `${convertInlineText(token.text)}\n\n`;
      }
      return '';
  }
}

/**
 * Process inline tokens (for bold, italic, links, etc.)
 */
function processInlineTokens(tokens: marked.Token[]): string {
  let result = '';

  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        result += (token as marked.Tokens.Text).text;
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
        result += `[${linkToken.text}|${linkToken.href}]`;
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
      default:
        // Fallback to text property if available
        if ('text' in token && typeof token.text === 'string') {
          result += token.text;
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
          itemText += convertInlineText((subToken as marked.Tokens.Text).text);
        } else if (subToken.type === 'list') {
          // Handle nested list
          result += `${indent} ${itemText}\n`;
          result += convertList(subToken as marked.Tokens.List, depth + 1);
          itemText = '';
        } else if ('text' in subToken && typeof subToken.text === 'string') {
          itemText += convertInlineText(subToken.text);
        }
      }
    } else {
      itemText = convertInlineText(item.text);
    }

    if (itemText) {
      result += `${indent} ${itemText}\n`;
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

  // Convert header row
  if (token.header.length > 0) {
    const headers = token.header.map((cell) => {
      const text = cell.tokens ? processInlineTokens(cell.tokens) : cell.text;
      return text;
    });
    result += `||${headers.join('||')}||\n`;
  }

  // Convert data rows
  for (const row of token.rows) {
    const cells = row.map((cell) => {
      const text = cell.tokens ? processInlineTokens(cell.tokens) : cell.text;
      return text;
    });
    result += `|${cells.join('|')}|\n`;
  }

  return `${result}\n`;
}

/**
 * Convert code block to Wiki Markup
 * Markdown: ```lang ... ``` → Wiki: {code:lang}...{code}
 */
function convertCodeBlock(token: marked.Tokens.Code): string {
  const lang = token.lang || 'none';
  const code = token.text;

  // Special handling for mermaid diagrams
  if (lang === 'mermaid') {
    return `{mermaid}\n${code}\n{mermaid}\n\n`;
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
    if ('text' in subToken && typeof subToken.text === 'string') {
      text += convertInlineText(subToken.text);
    }
  }
  return `{quote}\n${text}\n{quote}\n\n`;
}

/**
 * Convert inline markdown formatting to Wiki Markup
 * This handles: bold, italic, code, links, images
 */
function convertInlineText(text: string): string {
  let result = text;

  // Convert HTML br tags to newlines for multi-line content
  result = result.replace(/<br\s*\/?>/gi, '\n');

  // Convert images: ![alt](url) → !url!
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '!$2!');

  // Convert links: [text](url) → [text|url]
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '[$1|$2]');

  // Convert inline code first to avoid conflicts: `code` → {{code}}
  result = result.replace(/`([^`]+)`/g, '{{$1}}');

  // Convert strikethrough: ~~text~~ → -text-
  result = result.replace(/~~(.+?)~~/g, '-$1-');

  // Convert bold BEFORE italic to avoid conflicts: **text** or __text__ → *text*
  result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');
  result = result.replace(/__(.+?)__/g, '*$1*');

  // Convert italic: *text* or _text_ → _text_
  // Only match single asterisks/underscores (not doubles which are now converted to bold)
  result = result.replace(/(?<![*_])\*([^*]+?)\*(?![*_])/g, '_$1_');
  result = result.replace(/(?<![*_])_([^_]+?)_(?![*_])/g, '_$1_');

  return result;
}
