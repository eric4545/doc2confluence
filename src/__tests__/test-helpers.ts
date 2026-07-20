import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Load a markdown fixture file for testing
 * @param relativePath Path relative to __fixtures__/markdown/ directory
 * @returns The markdown content as a string
 */
export function loadMarkdownFixture(relativePath: string): string {
  const fixturePath = join(__dirname, '__fixtures__', 'markdown', relativePath);
  return readFileSync(fixturePath, 'utf-8');
}
