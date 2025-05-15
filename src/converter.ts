import * as marked from 'marked';
import { createReadStream } from 'fs';
import FormData from 'form-data';
import path from 'path';
import fs from 'fs/promises';
import fetch from 'node-fetch';
import Ajv from 'ajv';
import { ConfluenceClient } from './confluence';
import { parse as parseCsv } from 'csv-parse';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import * as adfBuilders from '@atlaskit/adf-utils/builders';

// Define ADFEntity type since we can't import it
export interface ADFEntity {
  type: string;
  content?: ADFEntity[];
  [key: string]: any;
}

// ADF Schema URL
const ADF_SCHEMA_URL = 'https://unpkg.com/@atlaskit/adf-schema@49.0.0/dist/json-schema/v1/full.json';
const ADF_SCHEMA_PATH = path.join(process.cwd(), 'cache', 'adf-schema.json');

// Initialize DOMPurify with JSDOM (required for Node.js environment)
const window = new JSDOM('').window;
const purify = createDOMPurify(window);

export interface ConversionOptions {
  expandMacros?: boolean;
  allowHtml?: boolean;
  parseEmoji?: boolean;
  parseMentions?: boolean;
  parseInlineCards?: boolean;
  uploadImages?: boolean;
  spaceKey?: string;
  basePath?: string;
  confluenceClient?: ConfluenceClient;
  useOfficialSchema?: boolean;
  format?: string;
  instanceType?: 'cloud' | 'server';
}

export interface Mark {
  type: string;
  attrs?: Record<string, any>;
}

export interface CsvOptions {
  delimiter?: string;
  hasHeader?: boolean;
  skipEmptyLines?: boolean;
}

export class Converter {
  private adfSchema: any = null;
  private ajv: Ajv;

  constructor() {
    this.ajv = new Ajv({ allErrors: true });
  }

  /**
   * Download and cache the official ADF schema
   */
  private async getADFSchema(): Promise<any> {
    // Return cached schema if available
    if (this.adfSchema) {
      return this.adfSchema;
    }

    try {
      // Create cache directory if it doesn't exist
      await fs.mkdir(path.dirname(ADF_SCHEMA_PATH), { recursive: true });

      // Try to read from cache file first
      try {
        const cachedSchema = await fs.readFile(ADF_SCHEMA_PATH, 'utf-8');
        this.adfSchema = JSON.parse(cachedSchema);
        return this.adfSchema;
      } catch (err) {
        // Cache file doesn't exist, download it
        console.log('Downloading official ADF schema...');
        const response = await fetch(ADF_SCHEMA_URL);
        if (!response.ok) {
          throw new Error(`Failed to download ADF schema: ${response.statusText}`);
        }

        this.adfSchema = await response.json();

        // Cache the schema
        await fs.writeFile(ADF_SCHEMA_PATH, JSON.stringify(this.adfSchema, null, 2));

        return this.adfSchema;
      }
    } catch (error) {
      console.error('Error loading ADF schema:', error);
      // Fall back to built-in validation
      return null;
    }
  }

  /**
   * Validate ADF against the official schema
   */
  private async validateADF(adf: ADFEntity, useOfficialSchema: boolean = false): Promise<boolean> {
    // Basic validation
    if (!adf || typeof adf !== 'object' || !adf.type || adf.type !== 'doc') {
      throw new Error('Invalid ADF: Document must have type "doc"');
    }

    // If official schema validation is requested
    if (useOfficialSchema) {
      try {
        const schema = await this.getADFSchema();
        if (schema) {
          const validate = this.ajv.compile(schema);
          const valid = validate(adf);

          if (!valid) {
            const errors = validate.errors || [];
            const errorMessages = errors.map(err =>
              `${err.instancePath} ${err.message}`
            ).join(', ');

            throw new Error(`ADF Schema validation failed: ${errorMessages}`);
          }
        }
      } catch (error) {
        if (error instanceof Error) {
          console.warn('Official schema validation failed:', error.message);
        } else {
          console.warn('Official schema validation failed with unknown error');
        }
        // Continue without official validation
      }
    }

    return true;
  }

  async convertToADF(markdown: string, options: ConversionOptions = {}): Promise<ADFEntity> {
    // Parse markdown to HTML AST
    const tokens = marked.lexer(markdown);

    // Convert to ADF (now handling async operations)
    const content: ADFEntity[] = [];
    for (const token of tokens) {
      const node = await this.tokenToADFNode(token, options);
      if (node) {
        content.push(node);
      }
    }

    const adf: ADFEntity = {
      type: 'doc',
      version: 1,
      content,
    };

    // Validate ADF
    await this.validateADF(adf, options.useOfficialSchema);

    return adf;
  }

  private async tokenToADFNode(token: marked.Tokens.Generic, options: ConversionOptions): Promise<ADFEntity | null> {
    switch (token.type) {
      case 'image':
        // Check if this is a CSV import
        if (token.href.endsWith('.csv')) {
          return this.handleCsvImport(token.href, options);
        }
        return this.handleImage(token as marked.Tokens.Image, options);
      case 'text':
        // Check for CSV import syntax: ![csv](path/to/file.csv)
        const csvMatch = token.text.match(/!\[csv\]\((.*?)\)/);
        if (csvMatch) {
          return this.handleCsvImport(csvMatch[1], options);
        }
        return null;
      case 'heading':
        return {
          type: 'heading',
          attrs: { level: token.depth },
          content: this.parseInlineContent(token.text, options),
        };

      case 'paragraph':
        // Check for special blocks
        if (token.text.startsWith(':::expand')) {
          return this.parseExpandMacro(token.text, options);
        }

        if (token.text.startsWith('<table')) {
          return this.parseHtmlTable(token.text);
        }

        // Handle task list item
        const taskMatch = token.text.match(/^\s*-\s+\[([ xX])\]\s*(.*)$/);
        if (taskMatch) {
          return {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: taskMatch[2],
                marks: [
                  {
                    type: 'action',
                    attrs: {
                      state: taskMatch[1].toLowerCase() === 'x' ? 'done' : 'todo'
                    }
                  }
                ]
              }
            ]
          };
        }

        // Check for emoji
        if (token.text.match(/:[a-z_]+:/)) {
          return {
            type: 'paragraph',
            content: this.parseEmojiContent(token.text),
          };
        }

        return {
          type: 'paragraph',
          content: this.parseInlineContent(token.text, options),
        };

      case 'list':
        const listToken = token as marked.Tokens.List;
        // Check if this is a task list
        const isTaskList = listToken.items.some(item =>
          item.task === true
        );

        if (isTaskList) {
          // Check if taskList is available (without triggering linter warnings)
          if (typeof adfBuilders.taskList === 'function' && typeof adfBuilders.taskItem === 'function') {
            // Create a task list directly
            return {
              type: 'taskList',
              content: await Promise.all(
                listToken.items.map(async (item) => {
                  return {
                    type: 'taskItem',
                    attrs: {
                      localId: this.generateLocalId(),
                      state: item.checked ? 'DONE' : 'TODO'
                    },
                    content: [
                      {
                        type: 'text',
                        text: item.text
                      }
                    ]
                  };
                })
              )
            };
          }
        }

        // Regular list - process each item and check for nested task lists
        return {
          type: listToken.ordered ? 'orderedList' : 'bulletList',
          content: await Promise.all(
            listToken.items.map(async (item) => {
              // If this is a task item, add action mark
              if (item.task) {
                return {
                  type: 'listItem',
                  content: [
                    {
                      type: 'paragraph',
                      content: [
                        {
                          type: 'text',
                          text: item.text,
                          marks: [
                            {
                              type: 'action',
                              attrs: {
                                state: item.checked ? 'done' : 'todo'
                              }
                            }
                          ]
                        }
                      ]
                    }
                  ]
                };
              }

              // Check if this item contains a nested bulleted task list
              const nestedBulletedTaskMatch = item.text.match(/^(.*?)\n\s*-\s+\[([ xX])\]/s);
              // Check if this item contains a nested numbered task list
              const nestedNumberedTaskMatch = item.text.match(/^(.*?)\n\s*\d+\.\s+\[([ xX])\]/s);

              if (nestedBulletedTaskMatch || nestedNumberedTaskMatch) {
                const match = nestedBulletedTaskMatch || nestedNumberedTaskMatch;
                const mainText = match![1].trim();
                // Process the nested task list separately
                const nestedListContent = await this.processNestedTaskList(item.text.substring(mainText.length).trim());

                return {
                  type: 'listItem',
                  content: [
                    {
                      type: 'paragraph',
                      content: this.parseInlineContent(mainText, options)
                    },
                    // Add the nested task list
                    ...(nestedListContent || [])
                  ]
                };
              }

              return {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: this.parseInlineContent(item.text, options)
                  }
                ]
              };
            })
          )
        };

      case 'table':
        return this.parseTable(token as marked.Tokens.Table);

      case 'code': {
        const codeToken = token as marked.Tokens.Code;

        // Handle CSV code blocks
        if (codeToken.lang && codeToken.lang.startsWith('csv')) {
          console.log('Processing CSV code block:', codeToken.text);
          const csvOptions: CsvOptions = {};

          // Parse CSV options from language identifier
          const langParts = codeToken.lang.split(';');
          if (langParts.length > 1) {
            const optionsStr = langParts[1];
            console.log('CSV options string:', optionsStr);

            optionsStr.split(',').forEach(opt => {
              const [key, value] = opt.split('=');
              console.log(`Processing CSV option: ${key}=${value}`);

              if (key.trim() === 'delimiter' && value) {
                csvOptions.delimiter = value.trim();
                console.log(`Set delimiter to: '${csvOptions.delimiter}'`);
              } else if (key.trim() === 'no-header') {
                csvOptions.hasHeader = false;
                console.log('Set hasHeader to false');
              } else if (key.trim() === 'skip-empty') {
                csvOptions.skipEmptyLines = true;
                console.log('Set skipEmptyLines to true');
              }
            });
          }

          try {
            return await this.parseCsvToTable(codeToken.text, csvOptions);
          } catch (error) {
            console.error('Error parsing CSV code block:', error);
            // Fall back to a regular code block if CSV parsing fails
            return {
              type: 'codeBlock',
              attrs: {
                language: 'csv'
              },
              content: [
                {
                  type: 'text',
                  text: codeToken.text
                }
              ]
            };
          }
        }

        // Handle regular code blocks
        return {
          type: 'codeBlock',
          attrs: {
            language: codeToken.lang || 'plaintext'
          },
          content: [
            {
              type: 'text',
              text: codeToken.text
            }
          ]
        };
      }

      default:
        return null;
    }
  }

  private parseInlineContent(text: string, options: ConversionOptions): ADFEntity[] {
    // Check for task list syntax first with proper regex (matching GitHub style checkboxes)
    const taskRegex = /\[([ xX])\]\s+([^\n]*)/g;
    if (taskRegex.test(text)) {
      // Reset regex lastIndex
      taskRegex.lastIndex = 0;

      let match;
      const content: ADFEntity[] = [];
      let lastIndex = 0;

      while ((match = taskRegex.exec(text)) !== null) {
        // Add any text before the task item
        if (match.index > lastIndex) {
          const beforeText = text.substring(lastIndex, match.index);
          this.splitTextIntoParts(beforeText, options, content);
        }

        // Add the task item as text with action mark
        content.push({
          type: 'text',
          text: match[2],
          marks: [
            {
              type: 'action',
              attrs: {
                state: match[1].toLowerCase() === 'x' ? 'done' : 'todo'
              }
            }
          ]
        });

        lastIndex = match.index + match[0].length;
      }

      // Add any remaining text after the last task item
      if (lastIndex < text.length) {
        const afterText = text.substring(lastIndex);
        this.splitTextIntoParts(afterText, options, content);
      }

      return content;
    }

    // Check for image syntax
    const imgRegex = /!\[(.*?)\]\((.*?)\)/g;
    let match;
    const content: ADFEntity[] = [];

    // If there's an image markdown in the text, extract it and handle it properly
    if (imgRegex.test(text)) {
      // Reset regex lastIndex
      imgRegex.lastIndex = 0;

      let lastIndex = 0;
      while ((match = imgRegex.exec(text)) !== null) {
        // Add any text before the image
        if (match.index > lastIndex) {
          const beforeText = text.substring(lastIndex, match.index);
          this.splitTextIntoParts(beforeText, options, content);
        }

        // Add the image as a mediaSingle with a media node inside
        // This is more compatible with Confluence's expectations
        content.push({
          type: 'mediaSingle',
          attrs: {
            layout: 'center',
          },
          content: [
            {
              type: 'media',
              attrs: {
                type: 'external',
                url: match[2],
                alt: match[1] || '',
              },
            },
          ],
        });

        lastIndex = match.index + match[0].length;
      }

      // Add any remaining text after the last image
      if (lastIndex < text.length) {
        const afterText = text.substring(lastIndex);
        this.splitTextIntoParts(afterText, options, content);
      }

      return content;
    }

    // No special syntax found, process normally
    return this.splitTextIntoParts(text, options, []);
  }

  private splitTextIntoParts(text: string, options: ConversionOptions, existingContent: ADFEntity[] = []): ADFEntity[] {
    const parts = text.split(/(\s+)/);
    const content = existingContent;

    parts.forEach((part: string, index: number) => {
      if (part.trim() === '') {
        content.push({ type: 'text', text: part });
        return;
      }

      // Handle mentions
      if (options.parseMentions && part.startsWith('@')) {
        const mention = this.parseMentions(part);
        if (mention) {
          content.push(mention);
          return;
        }
      }

      // Handle inline cards
      if (options.parseInlineCards && part.match(/^https?:\/\//)) {
        const card = this.parseInlineCard(part);
        if (card) {
          content.push(card);
          return;
        }
      }

      // Handle status
      if (part.match(/^\[(.*?)\]$/)) {
        const status = this.parseStatus(part);
        if (status) {
          content.push(status);
          return;
        }
      }

      // Handle panel
      if (part.startsWith('{panel:')) {
        const panel = this.parsePanel(part);
        if (panel) {
          content.push(panel);
          return;
        }
      }

      // Default to text
      content.push({ type: 'text', text: part });
    });

    return content;
  }

  private parseEmojiContent(text: string): ADFEntity[] {
    const parts = text.split(/(:[a-z_]+:)/);
    return parts.map(part => {
      if (part.match(/^:[a-z_]+:$/)) {
        return {
          type: 'emoji',
          attrs: {
            shortName: part,
            id: part.replace(/:/g, ''),
            text: part,
          },
        };
      }
      return { type: 'text', text: part };
    });
  }

  private parseMentions(text: string): ADFEntity | null {
    const match = text.match(/^@([a-zA-Z0-9_-]+)$/);
    if (!match) return null;

    return {
      type: 'mention',
      attrs: {
        id: match[1],
        text: text,
        accessLevel: 'CONTAINER',
      },
    };
  }

  private parseInlineCard(url: string): ADFEntity | null {
    if (!url.match(/^https?:\/\//)) return null;

    return {
      type: 'inlineCard',
      attrs: {
        url,
      },
    };
  }

  private parseStatus(text: string): ADFEntity | null {
    const match = text.match(/^\[(.*?)\]$/);
    if (!match) return null;

    return {
      type: 'status',
      attrs: {
        text: match[1],
        color: 'grey',
      },
    };
  }

  private parsePanel(text: string): ADFEntity | null {
    const match = text.match(/^\{panel:title=(.*?)\}(.*?)\{panel\}$/);
    if (!match) return null;

    return {
      type: 'panel',
      attrs: {
        panelType: 'info',
      },
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: match[2] }],
        },
      ],
    };
  }

  private parseExpandMacro(text: string, options: ConversionOptions): ADFEntity | null {
    const match = text.match(/^:::expand\s*(.*?)\s*:::$/s);
    if (!match) return null;

    return {
      type: 'expand',
      attrs: {
        title: 'Expand',
      },
      content: [
        {
          type: 'paragraph',
          content: this.parseInlineContent(match[1], options),
        },
      ],
    };
  }

  private parseTable(token: marked.Tokens.Table): ADFEntity {
    const rows: ADFEntity[] = [];

    // Add header row
    if (token.header.length > 0) {
      rows.push({
        type: 'tableRow',
        content: token.header.map(cell => ({
          type: 'tableHeader',
          attrs: {
            colspan: 1,
            rowspan: 1,
            background: null,
          },
          content: this.parseInlineContent(cell.text, {}),
        })),
      });
    }

    // Add data rows
    token.rows.forEach(row => {
      rows.push({
        type: 'tableRow',
        content: row.map(cell => ({
          type: 'tableCell',
          attrs: {
            colspan: 1,
            rowspan: 1,
            background: null,
          },
          content: this.parseInlineContent(cell.text, {}),
        })),
      });
    });

    return {
      type: 'table',
      content: rows,
    };
  }

  private parseHtmlTable(html: string): ADFEntity {
    const dom = new JSDOM(html);
    const table = dom.window.document.querySelector('table');
    if (!table) {
      throw new Error('Invalid HTML table');
    }
    return this.domTableToADF(table as HTMLTableElement);
  }

  private domTableToADF(table: HTMLTableElement): ADFEntity {
    const rows: ADFEntity[] = [];
    const tableRows = table.querySelectorAll('tr');

    tableRows.forEach(row => {
      const cells = row.querySelectorAll('th, td');
      const rowContent: ADFEntity[] = [];

      cells.forEach(cell => {
        const isHeader = cell.tagName.toLowerCase() === 'th';
        rowContent.push({
          type: isHeader ? 'tableHeader' : 'tableCell',
          attrs: {
            colspan: parseInt(cell.getAttribute('colspan') || '1'),
            rowspan: parseInt(cell.getAttribute('rowspan') || '1'),
            background: null,
          },
          content: this.parseInlineContent(cell.textContent || '', {}),
        });
      });

      rows.push({
        type: 'tableRow',
        content: rowContent,
      });
    });

    return {
      type: 'table',
      content: rows,
    };
  }

  private async handleImage(token: marked.Tokens.Image, options: ConversionOptions): Promise<ADFEntity | null> {
    if (!options.uploadImages || !options.confluenceClient || !options.spaceKey) {
      // Return as mediaSingle with media node inside
      return {
        type: 'mediaSingle',
        attrs: {
          layout: 'center',
        },
        content: [
          {
            type: 'media',
            attrs: {
              type: 'external',
              url: token.href,
              alt: token.text || '',
            },
          },
        ],
      };
    }

    try {
      const imagePath = path.resolve(options.basePath || '', token.href);
      const response = await options.confluenceClient.uploadImage(options.spaceKey, imagePath);

      // Return as mediaSingle with media node inside
      return {
        type: 'mediaSingle',
        attrs: {
          layout: 'center',
        },
        content: [
          {
            type: 'media',
            attrs: {
              type: 'file',
              id: response.id,
              collection: 'contentId',
              alt: token.text || '',
            },
          },
        ],
      };
    } catch (error) {
      console.error('Failed to upload image:', error);

      // Fallback to external URL
      return {
        type: 'mediaSingle',
        attrs: {
          layout: 'center',
        },
        content: [
          {
            type: 'media',
            attrs: {
              type: 'external',
              url: token.href,
              alt: token.text || '',
            },
          },
        ],
      };
    }
  }

  private async handleCsvImport(csvPath: string, options: ConversionOptions): Promise<ADFEntity | null> {
    try {
      const fullPath = path.resolve(options.basePath || '', csvPath);
      const content = await fs.readFile(fullPath, 'utf-8');
      return this.parseCsvToTable(content, {});
    } catch (error) {
      console.error('Failed to import CSV:', error);
      return null;
    }
  }

  private parseCsvToTable(content: string, options: CsvOptions): Promise<ADFEntity> {
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
        columns: options.hasHeader !== false,
        skip_empty_lines: options.skipEmptyLines || true,
        trim: true,
        delimiter: options.delimiter,
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

          // Now we know records[0] exists
          const table: ADFEntity = {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: Object.keys(records[0] || {}).map(header => ({
                  type: 'tableHeader',
                  attrs: {
                    colspan: 1,
                    rowspan: 1,
                    background: null,
                  },
                  content: [{ type: 'text', text: header }],
                })),
              },
              ...records.map(row => ({
                type: 'tableRow',
                content: Object.values(row).map(cell => ({
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
          console.error('CSV parsing error:', err);
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
                  }
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
                  }
                ],
              },
            ],
          });
        });
    });
  }

  // Add a helper method to generate unique IDs for task items
  private generateLocalId(): string {
    return `task-${Math.random().toString(36).substring(2, 10)}`;
  }

  /**
   * Process a nested task list from item text
   */
  private async processNestedTaskList(text: string): Promise<ADFEntity[] | null> {
    // Check for a bulleted task list
    const bulletedTaskRegex = /^\s*-\s+\[([ xX])\]\s+(.*?)(?:\n|$)/gm;
    const bulletedMatches = [...text.matchAll(bulletedTaskRegex)];

    // Check for a numbered task list
    const numberedTaskRegex = /^\s*\d+\.\s+\[([ xX])\]\s+(.*?)(?:\n|$)/gm;
    const numberedMatches = [...text.matchAll(numberedTaskRegex)];

    // Combine matches
    const allMatches = [...bulletedMatches, ...numberedMatches];

    if (allMatches.length > 0) {
      // Sort matches by their position in text to maintain order
      allMatches.sort((a, b) => a.index! - b.index!);

      // Create a task list
      const taskListEntity: ADFEntity = {
        type: 'taskList',
        content: allMatches.map(match => {
          const state = match[1].toLowerCase() === 'x' ? 'DONE' : 'TODO';
          const taskText = match[2].trim();

          return {
            type: 'taskItem',
            attrs: {
              localId: this.generateLocalId(),
              state
            },
            content: [
              {
                type: 'text',
                text: taskText
              }
            ]
          };
        })
      };

      return [taskListEntity];
    }

    return null;
  }
}