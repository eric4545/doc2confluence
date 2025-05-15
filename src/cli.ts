#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { getConfluenceConfig, getParentPageId, validateSpaceKey } from './config';
import { ConfluenceClient } from './confluence';
import type { ConfluenceInstanceType } from './confluence';
import { Converter } from './converter';
import { type InputFormat, convertFile } from './formats';
import { parseMarkdownFile } from './metadata';
import type { ADFEntity } from './types';

interface ConvertOptions {
  dryRun?: boolean;
  instanceType?: ConfluenceInstanceType;
  format?: InputFormat;
  toc?: boolean;
  inlineCards?: boolean;
  uploadImages?: boolean;
  useOfficialSchema?: boolean;
  output?: string;
  title?: string;
  space?: string;
  parent?: string;
}

const program = new Command();

// Global debug flag
let isDebugMode = false;

// Helper function for detailed error logging
function logError(message: string, error: Error | unknown) {
  console.error(`Error: ${message}`);
  if (error instanceof Error) {
    console.error(error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  } else {
    console.error(String(error));
  }
}

program
  .name('doc2conf')
  .description('Convert documentation files to Confluence ADF format')
  .version('1.0.0')
  .option('--debug', 'Enable debug mode with detailed error logging');

program
  .command('convert')
  .description('Convert a file to ADF format')
  .argument('<input-file>', 'Input file path')
  .option('-o, --output <file>', 'Output file path')
  .option('-f, --format <format>', 'Input format (markdown, asciidoc, csv)', 'markdown')
  .option('--toc', 'Generate table of contents')
  .option('--inline-cards', 'Parse inline cards')
  .option('--upload-images', 'Upload images to Confluence')
  .option('--use-official-schema', 'Validate against official ADF schema')
  .option('--dry-run', 'Preview ADF output without saving')
  .option('--instance-type <type>', 'Confluence instance type (cloud or server)', 'cloud')
  .action(async (file: string, options: ConvertOptions) => {
    try {
      // Set debug mode from global option
      isDebugMode = program.opts().debug || false;

      const format = options.format as InputFormat;
      const adf = await convertFile(file, format, {
        generateToc: options.toc,
        parseInlineCards: options.inlineCards,
        uploadImages: options.uploadImages,
        useOfficialSchema: options.useOfficialSchema,
        instanceType: options.instanceType || 'cloud',
      });

      if (options.dryRun) {
        console.log(JSON.stringify(adf, null, 2));
        return;
      }

      const outputPath =
        options.output ||
        path.join(path.dirname(file), `${path.basename(file, path.extname(file))}.adf.json`);

      await fs.writeFile(outputPath, JSON.stringify(adf, null, 2));
      console.log(`Converted ${file} to ${outputPath}`);
    } catch (error: unknown) {
      logError('Conversion failed', error);
      process.exit(1);
    }
  });

program
  .command('push')
  .description('Convert and push a file to Confluence')
  .argument('<input-file>', 'Input file path')
  .option('-s, --space <key>', 'Confluence space key')
  .option('-p, --parent <id>', 'Parent page ID')
  .option('-t, --title <title>', 'Page title')
  .option('-f, --format <format>', 'Input format (markdown, asciidoc, csv)', 'markdown')
  .option('--toc', 'Generate table of contents')
  .option('--inline-cards', 'Parse inline cards')
  .option('--upload-images', 'Upload images to Confluence')
  .option('--use-official-schema', 'Validate against official ADF schema')
  .option('--instance-type <type>', 'Confluence instance type (cloud or server)', 'cloud')
  .action(async (file: string, options: ConvertOptions) => {
    try {
      // Set debug mode from global option
      isDebugMode = program.opts().debug || false;

      if (isDebugMode) {
        console.log('DEBUG: Starting push operation with options:', options);
      }

      const config = await getConfluenceConfig();

      // Override instance type if specified in command line
      if (options.instanceType) {
        config.instanceType = options.instanceType;
      }

      if (isDebugMode) {
        console.log('DEBUG: Confluence config:', {
          url: config.url,
          username: config.username,
          hasApiKey: !!config.apiKey,
          defaultSpace: config.defaultSpace,
          defaultParentId: config.defaultParentId,
          instanceType: config.instanceType,
        });
      }

      type PushMetadata = {
        space?: string;
        parentId?: string;
        title?: string;
        pageId?: string;
        labels: string[];
      };

      const metadata: PushMetadata = {
        space: undefined,
        parentId: undefined,
        title: options.title,
        pageId: undefined,
        labels: [],
      };

      let adf: ADFEntity;

      if (file.endsWith('.adf.json')) {
        // If file is already ADF JSON, just read it
        if (isDebugMode) {
          console.log('DEBUG: Loading ADF from JSON file');
        }
        const content = await fs.readFile(file, 'utf-8');
        adf = JSON.parse(content);
      } else {
        // Otherwise convert the file
        if (isDebugMode) {
          console.log('DEBUG: Converting file to ADF');
        }
        const format = options.format as InputFormat;

        // If markdown format, check for front matter before conversion
        if (format === 'markdown' && !file.endsWith('.adf.json')) {
          const fileContent = await fs.readFile(file, 'utf-8');
          const { metadata: frontMatterMetadata } = parseMarkdownFile(fileContent);

          // Update metadata from front matter
          if (frontMatterMetadata) {
            if (isDebugMode) {
              console.log('DEBUG: Found front matter metadata:', frontMatterMetadata);
            }

            // Only use front matter values if command line options are not provided
            metadata.space = options.space || frontMatterMetadata.space;
            metadata.parentId = options.parent || frontMatterMetadata.parentId;
            metadata.title = options.title || frontMatterMetadata.title;
            metadata.pageId = frontMatterMetadata.pageId; // No command line option for pageId
            metadata.labels = frontMatterMetadata.labels || [];
          }
        }

        // Convert with metadata handling
        adf = await convertFile(file, format, {
          generateToc: options.toc,
          parseInlineCards: options.inlineCards,
          uploadImages: options.uploadImages,
          useOfficialSchema: options.useOfficialSchema,
        });
      }

      // Validate space key and parent ID, potentially using metadata values
      const spaceKey = validateSpaceKey(options.space || metadata.space || config.defaultSpace);
      const parentId = await getParentPageId(
        options.parent || metadata.parentId || config.defaultParentId
      );

      if (isDebugMode) {
        console.log('DEBUG: Creating Confluence client');
        console.log(`DEBUG: Base URL: ${config.url}`);
      }

      const client = new ConfluenceClient(
        config.url,
        {
          // Prefer email over username if available
          email: config.email || config.username,
          apiToken: config.apiKey,
          personalAccessToken: config.personalAccessToken,
        },
        isDebugMode,
        config.instanceType
      );

      // Extract title from metadata, command line option, first heading, or filename
      let pageTitle = metadata.title;
      if (isDebugMode && pageTitle) {
        console.log(`DEBUG: Using title from metadata: "${pageTitle}"`);
      }

      if (!pageTitle && adf && adf.content) {
        // Look for the first heading in the ADF content
        const firstHeading = adf.content.find(
          (node: ADFEntity) => node.type === 'heading' && node.content && node.content.length > 0
        );

        if (firstHeading?.content) {
          // Extract text from the heading
          const text = firstHeading.content
            .filter((c: ADFEntity) => c.type === 'text')
            .map((c: ADFEntity) => c.text)
            .join('');

          if (text) {
            pageTitle = text;
            if (isDebugMode) {
              console.log(`DEBUG: Using first heading as title: "${pageTitle}"`);
            }
          }
        }
      }

      // Fall back to filename if no heading found
      if (!pageTitle) {
        pageTitle = path.basename(file, path.extname(file));
        if (isDebugMode) {
          console.log(`DEBUG: No heading found, using filename as title: "${pageTitle}"`);
        }
      }

      if (isDebugMode) {
        console.log(`DEBUG: Pushing to Confluence. SpaceKey: ${spaceKey}, Title: ${pageTitle}`);
      }

      // Use pageId from metadata if available
      const pageIdParam = metadata.pageId || undefined;

      const pageId = await client.createOrUpdatePage(
        spaceKey,
        pageTitle,
        adf,
        parentId,
        pageIdParam,
        metadata.labels
      );

      if (isDebugMode) {
        console.log('DEBUG: Response from createOrUpdatePage:', pageId);
      }

      console.log(`Successfully pushed to Confluence (Page ID: ${pageId.id || pageId})`);

      // Build the complete URL from the response
      let pageUrl = 'Not available';
      if (pageId._links?.webui && pageId._links?.base) {
        pageUrl = `${pageId._links.base}${pageId._links.webui}`;
      } else if (pageId._links?.webui) {
        // If no base URL is provided, use the configured URL
        const config = getConfluenceConfig();
        pageUrl = `${config.url}${pageId._links.webui}`;
      }

      console.log(`Page URL: ${pageUrl}`);
    } catch (error: unknown) {
      logError('Push to Confluence failed', error);
      process.exit(1);
    }
  });

program.parse();
