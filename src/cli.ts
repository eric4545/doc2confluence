#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { Converter } from './converter';
import { ConfluenceClient } from './confluence';
import { getConfluenceConfig, validateSpaceKey, getParentPageId } from './config';
import { convertFile, InputFormat } from './formats';

const program = new Command();

// Global debug flag
let isDebugMode = false;

// Helper function for detailed error logging
function logError(message: string, error: any) {
  console.error(`Error: ${message}`);

  if (isDebugMode) {
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
      console.error('Response headers:', error.response.headers);
    } else if (error.request) {
      console.error('Request details:', error.request);
    }
    console.error('Full error:', error);
    console.error('Stack trace:', error.stack);
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
  .action(async (file: string, options: any) => {
    try {
      // Set debug mode from global option
      isDebugMode = program.opts().debug || false;

      const format = options.format as InputFormat;
      const adf = await convertFile(file, format, {
        generateToc: options.toc,
        parseInlineCards: options.inlineCards,
        uploadImages: options.uploadImages,
        useOfficialSchema: options.useOfficialSchema,
      });

      if (options.dryRun) {
        console.log(JSON.stringify(adf, null, 2));
        return;
      }

      const outputPath = options.output || path.join(
        path.dirname(file),
        `${path.basename(file, path.extname(file))}.adf.json`
      );

      await fs.writeFile(outputPath, JSON.stringify(adf, null, 2));
      console.log(`Converted ${file} to ${outputPath}`);
    } catch (error: any) {
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
  .action(async (file: string, options: any) => {
    try {
      // Set debug mode from global option
      isDebugMode = program.opts().debug || false;

      if (isDebugMode) {
        console.log('DEBUG: Starting push operation with options:', options);
      }

      const config = await getConfluenceConfig();
      if (isDebugMode) {
        console.log('DEBUG: Confluence config:', {
          url: config.url,
          username: config.username,
          hasApiKey: !!config.apiKey,
          defaultSpace: config.defaultSpace,
          defaultParentId: config.defaultParentId
        });
      }

      const spaceKey = validateSpaceKey(options.space || config.defaultSpace);
      const parentId = await getParentPageId(options.parent || config.defaultParentId);

      let adf;
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
        adf = await convertFile(file, format, {
          generateToc: options.toc,
          parseInlineCards: options.inlineCards,
          uploadImages: options.uploadImages,
          useOfficialSchema: options.useOfficialSchema,
          spaceKey,
          parentId,
        });
      }

      if (isDebugMode) {
        console.log('DEBUG: Creating Confluence client');
        console.log(`DEBUG: Base URL: ${config.url}`);
      }

      const client = new ConfluenceClient(config.url, config.username, config.apiKey, isDebugMode);

      // Extract title from first heading if available and not explicitly set
      let pageTitle = options.title;
      if (!pageTitle && adf && adf.content) {
        // Look for the first heading in the ADF content
        const firstHeading = adf.content.find(
          (node: any) => node.type === 'heading' && node.content && node.content.length > 0
        );

        if (firstHeading && firstHeading.content) {
          // Extract text from the heading
          const text = firstHeading.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
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

      const pageId = await client.createOrUpdatePage(
        spaceKey,
        pageTitle,
        adf,
        parentId
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
    } catch (error: any) {
      logError('Push to Confluence failed', error);
      process.exit(1);
    }
  });

program.parse();