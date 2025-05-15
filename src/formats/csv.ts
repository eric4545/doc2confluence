import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseCsv } from 'csv-parse';
import type { ADFEntity } from '../types';

export interface CsvOptions {
  delimiter?: string;
  hasHeader?: boolean;
  skipEmptyLines?: boolean;
  trim?: boolean;
}

export async function importFromFile(
  filePath: string,
  basePath: string,
  options: CsvOptions = {}
): Promise<ADFEntity | null> {
  try {
    const fullPath = path.resolve(basePath, filePath);
    const csvContent = await fs.readFile(fullPath, 'utf-8');
    return parseToTable(csvContent, options);
  } catch (error) {
    console.error(`Failed to import CSV ${filePath}:`, error);
    return null;
  }
}

export function parseToTable(csvContent: string, options: CsvOptions = {}): Promise<ADFEntity> {
  const { delimiter = ',', hasHeader = true, skipEmptyLines = true, trim = true } = options;

  return new Promise((resolve, reject) => {
    const records: string[][] = [];

    parseCsv(csvContent, {
      columns: hasHeader,
      delimiter,
      skip_empty_lines: skipEmptyLines,
      trim,
    })
      .on('data', (record: string[]) => {
        records.push(record);
      })
      .on('end', () => {
        const table: ADFEntity = {
          type: 'table',
          attrs: {
            isNumberColumnEnabled: false,
            layout: 'default',
          },
          content: createTableContent(records, hasHeader),
        };
        resolve(table);
      })
      .on('error', reject);
  });
}

export function createTableContent(records: string[][], hasHeader: boolean): ADFEntity[] {
  if (records.length === 0) {
    return [];
  }

  const content: ADFEntity[] = [];
  const startIndex = hasHeader ? 1 : 0;

  // Add header row if needed
  if (hasHeader) {
    content.push({
      type: 'tableRow',
      content: Object.keys(records[0]).map((header) => ({
        type: 'tableHeader',
        attrs: {
          colspan: 1,
          rowspan: 1,
          background: null,
        },
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: header }],
          },
        ],
      })),
    });
  }

  // Add data rows
  for (let i = startIndex; i < records.length; i++) {
    content.push({
      type: 'tableRow',
      content: Object.values(records[i]).map((cell) => ({
        type: 'tableCell',
        attrs: {
          colspan: 1,
          rowspan: 1,
          background: null,
        },
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: cell.toString() }],
          },
        ],
      })),
    });
  }

  return content;
}
