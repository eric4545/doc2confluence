/**
 * Represents the Atlassian Document Format (ADF) entity structure
 */
export interface ADFEntity {
  type: string;
  attrs?: Record<string, any>;
  content?: ADFEntity[];
  text?: string;
  marks?: {
    type: string;
    attrs?: Record<string, any>;
  }[];
}

/**
 * Represents a complete ADF document
 */
export interface ADFDocument {
  version: number;
  type: 'doc';
  content: ADFEntity[];
}