import fs from 'node:fs/promises';
import path from 'node:path';

export async function importFromFile(filePath: string, basePath: string): Promise<string | null> {
  try {
    const fullPath = path.resolve(basePath, filePath);
    const wikiContent = await fs.readFile(fullPath, 'utf-8');
    return wikiContent;
  } catch (error) {
    console.error(`Failed to import wiki file ${filePath}:`, error);
    return null;
  }
}
