import fs from 'node:fs/promises';
import asciidoctor from 'asciidoctor';
import { parse as parseCsv } from 'csv-parse';
import { Converter } from '../converter';
import type { ConversionOptions } from '../converter';
import { parseMarkdownFile, validateMetadata } from '../metadata';

// Define ADFEntity type since we can't import it
export interface ADFEntity {
  type: string;
  content?: ADFEntity[];
  [key: string]: unknown;
}

export type InputFormat = 'markdown' | 'asciidoc' | 'csv';

// Extend ConversionOptions to ensure macro options are included
export interface ExtendedConversionOptions extends ConversionOptions {
  macroFormat?: 'markdown' | 'html';
  format?: string;
}

export interface FormatConverter {
  convert(content: string, options: ExtendedConversionOptions): Promise<ADFEntity>;
}

export class AsciiDocConverter implements FormatConverter {
  private asciidoctor: unknown;

  constructor() {
    this.asciidoctor = asciidoctor();
  }

  async convert(content: string, options: ExtendedConversionOptions): Promise<ADFEntity> {
    const html = (
      this.asciidoctor as { convert: (content: string, options: Record<string, unknown>) => string }
    ).convert(content, {
      safe: 'safe',
      backend: 'html5',
      doctype: 'article',
      attributes: {
        showtitle: true,
        icons: 'font',
        'source-highlighter': 'highlightjs',
      },
    });

    // Convert HTML to ADF using the existing converter
    const converter = new Converter();
    return converter.convertToADF(html, { ...options, format: 'html' });
  }
}

export class CsvConverter implements FormatConverter {
  async convert(content: string, options: ExtendedConversionOptions): Promise<ADFEntity> {
    return new Promise((resolve, reject) => {
      // If content is empty or whitespace only, return empty table
      if (!content || content.trim() === '') {
        resolve({
          type: 'table',
          content: [], // Empty table
        });
        return;
      }

      const records: string[][] = [];

      const parser = parseCsv(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        // Be more lenient with record lengths
        relax_column_count: true,
      });

      parser
        .on('data', (record: string[]) => {
          records.push(record);
        })
        .on('end', () => {
          // Handle empty CSV case
          if (records.length === 0) {
            resolve({
              type: 'table',
              content: [], // Empty table
            });
            return;
          }

          const table: ADFEntity = {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: Object.keys(records[0] || {}).map((header) => ({
                  type: 'tableHeader',
                  attrs: {
                    colspan: 1,
                    rowspan: 1,
                    background: null,
                  },
                  content: [{ type: 'text', text: header }],
                })),
              },
              ...records.map((row) => ({
                type: 'tableRow',
                content: Object.values(row).map((cell) => ({
                  type: 'tableCell',
                  attrs: {
                    colspan: 1,
                    rowspan: 1,
                    background: null,
                  },
                  content: [{ type: 'text', text: (cell || '').toString() }],
                })),
              })),
            ],
          };
          resolve(table);
        })
        .on('error', (err) => {
          console.error('CSV parsing error in CsvConverter:', err);
          // Instead of rejecting, return a minimal table with error info
          resolve({
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  {
                    type: 'tableHeader',
                    attrs: {
                      colspan: 1,
                      rowspan: 1,
                      background: null,
                    },
                    content: [{ type: 'text', text: 'Error' }],
                  },
                ],
              },
              {
                type: 'tableRow',
                content: [
                  {
                    type: 'tableCell',
                    attrs: {
                      colspan: 1,
                      rowspan: 1,
                      background: null,
                    },
                    content: [{ type: 'text', text: `Could not parse CSV: ${err.message}` }],
                  },
                ],
              },
            ],
          });
        });
    });
  }
}

export class MarkdownConverter implements FormatConverter {
  private converter: Converter;

  constructor() {
    this.converter = new Converter();
  }

  async convert(content: string, options: ExtendedConversionOptions): Promise<ADFEntity> {
    // Parse front matter metadata
    const { content: mdContent, metadata } = parseMarkdownFile(content);

    // Merge metadata with options
    // Note: metadata from frontmatter takes precedence over CLI options
    const mergedOptions = {
      ...options,
      spaceKey: metadata.space || options.spaceKey,
      parentId: metadata.parentId || options.parentId,
      title: metadata.title || options.title,
      pageId: metadata.pageId || options.pageId,
      labels: metadata.labels || options.labels || [],
      macroFormat: metadata.macroFormat || options.macroFormat,
    };

    return this.converter.convertToADF(mdContent, mergedOptions);
  }
}

export async function getConverter(format: InputFormat): Promise<FormatConverter> {
  switch (format) {
    case 'asciidoc':
      return new AsciiDocConverter();
    case 'csv':
      return new CsvConverter();
    default:
      return new MarkdownConverter();
  }
}

export async function convertFile(
  filePath: string,
  format: InputFormat,
  options: ExtendedConversionOptions
): Promise<ADFEntity> {
  const content = await fs.readFile(filePath, 'utf-8');
  const converter = await getConverter(format);
  return converter.convert(content, options);
}
