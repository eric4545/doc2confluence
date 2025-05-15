/**
 * Represents the Atlassian Document Format (ADF) entity structure
 */
export interface ADFEntity {
  type: string;
  attrs?: Record<string, string | number | boolean | null>;
  content?: ADFEntity[];
  text?: string;
  marks?: {
    type: string;
    attrs?: Record<string, string | number | boolean | null>;
  }[];
  [key: string]: unknown;
}

/**
 * Represents a complete ADF document
 */
export interface ADFDocument {
  version: number;
  type: 'doc';
  content: ADFEntity[];
}
