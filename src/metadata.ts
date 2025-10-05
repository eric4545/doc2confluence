import matter from 'gray-matter';

export interface ConfluenceMetadata {
  space?: string;
  title?: string;
  parentId?: string;
  pageId?: string;
  labels?: string[];
  macroFormat?: 'markdown' | 'html';
}

export interface ParsedMarkdown {
  content: string;
  metadata: ConfluenceMetadata;
}

export function parseMarkdownFile(content: string): ParsedMarkdown {
  const { data, content: markdownContent } = matter(content);

  // Support both new macroFormat and legacy useMarkdownMacro for backward compatibility
  let macroFormat: 'markdown' | 'html' | undefined;
  if (data.confluence?.macroFormat || data.macroFormat) {
    macroFormat = data.confluence?.macroFormat || data.macroFormat;
  } else if (data.confluence?.useMarkdownMacro || data.useMarkdownMacro) {
    console.warn(
      '\x1b[33m⚠ Deprecation Warning:\x1b[0m "useMarkdownMacro" is deprecated. Please use "macroFormat: markdown" instead.'
    );
    macroFormat = 'markdown';
  } else if (data.confluence?.useHtmlMacro || data.useHtmlMacro) {
    console.warn(
      '\x1b[33m⚠ Deprecation Warning:\x1b[0m "useHtmlMacro" is deprecated. Please use "macroFormat: html" instead.'
    );
    macroFormat = 'html';
  }

  const metadata: ConfluenceMetadata = {
    space: data.confluence?.space || data.space,
    title: data.confluence?.title || data.title,
    parentId: data.confluence?.parentId || data.parentId,
    pageId: data.confluence?.pageId || data.pageId,
    labels: data.confluence?.labels || data.labels || [],
    macroFormat,
  };

  return {
    content: markdownContent,
    metadata,
  };
}

export function validateMetadata(
  metadata: ConfluenceMetadata,
  spaceFromEnv?: string,
  parentIdFromEnv?: string
): ConfluenceMetadata {
  return {
    space: metadata.space || spaceFromEnv,
    parentId: metadata.parentId || parentIdFromEnv,
    title: metadata.title,
    pageId: metadata.pageId,
    labels: metadata.labels,
    macroFormat: metadata.macroFormat,
  };
}
