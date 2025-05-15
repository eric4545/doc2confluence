import matter from 'gray-matter';

export interface ConfluenceMetadata {
  space?: string;
  title?: string;
  parentId?: string;
  pageId?: string;
  labels?: string[];
}

export interface ParsedMarkdown {
  content: string;
  metadata: ConfluenceMetadata;
}

export function parseMarkdownFile(content: string): ParsedMarkdown {
  const { data, content: markdownContent } = matter(content);

  const metadata: ConfluenceMetadata = {
    space: data.confluence?.space || data.space,
    title: data.confluence?.title || data.title,
    parentId: data.confluence?.parentId || data.parentId,
    pageId: data.confluence?.pageId || data.pageId,
    labels: data.confluence?.labels || data.labels || [],
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
  };
}
