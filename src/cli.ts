#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { getConfluenceConfig, getParentPageId, validateSpaceKey } from './config';
import type { ConfluenceInstanceType } from './confluence';
import { ConfluenceClient } from './confluence';
import { convertFile, type InputFormat } from './formats';
import { parseMarkdownFile } from './metadata';
import type { ADFEntity } from './types';
import { formatValidationResults, validateWikiMarkup } from './wiki-markup-validator';

type MermaidTheme = 'default' | 'dark' | 'forest' | 'neutral' | 'base';

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
  pageId?: string;
  macroFormat?: 'markdown' | 'html';
  validate?: boolean;
  // Mermaid options
  mermaidFormat?: 'native' | 'html';
  mermaidVersion?: string;
  mermaidTheme?: MermaidTheme;
  mermaidConfig?: string; // JSON string from CLI
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
  .option(
    '-f, --format <format>',
    'Input format: markdown (default), asciidoc, csv, or confluence-markup (converts markdown to wiki markup)',
    'markdown'
  )
  .option('--toc', 'Generate table of contents')
  .option('--inline-cards', 'Parse inline cards')
  .option('--upload-images', 'Upload images to Confluence')
  .option('--use-official-schema', 'Validate against official ADF schema')
  .option('--dry-run', 'Preview ADF output without saving')
  .option('--instance-type <type>', 'Confluence instance type (cloud or server)', 'cloud')
  .option('--macro-format <format>', 'Use macro format instead of ADF (markdown or html)')
  .option(
    '--mermaid-format <format>',
    'Mermaid rendering: native (default, uses Confluence built-in ~9.x) or html (uses latest from CDN)'
  )
  .option('--mermaid-version <version>', 'Mermaid.js version for CDN (e.g., 11, 10.9.0)', '11')
  .option(
    '--mermaid-theme <theme>',
    'Mermaid theme: default, dark, forest, neutral, base',
    'default'
  )
  .option('--mermaid-config <json>', 'Custom Mermaid config as JSON string')
  .action(async (file: string, options: ConvertOptions) => {
    try {
      // Set debug mode from global option
      isDebugMode = program.opts().debug || false;

      const format = options.format as InputFormat;

      // Parse mermaid config if provided
      let mermaidConfig: Record<string, unknown> | undefined;
      if (options.mermaidConfig) {
        try {
          mermaidConfig = JSON.parse(options.mermaidConfig);
        } catch (e) {
          console.error('Error: Invalid JSON in --mermaid-config');
          process.exit(1);
        }
      }

      const adf = await convertFile(file, format, {
        generateToc: options.toc,
        parseInlineCards: options.inlineCards,
        uploadImages: options.uploadImages,
        useOfficialSchema: options.useOfficialSchema,
        instanceType: options.instanceType || 'cloud',
        macroFormat: options.macroFormat,
        mermaidFormat: options.mermaidFormat,
        mermaidVersion: options.mermaidVersion,
        mermaidTheme: options.mermaidTheme as MermaidTheme,
        mermaidConfig,
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
  .option('--page-id <id>', 'Confluence page ID to update')
  .option(
    '-f, --format <format>',
    'Input format: markdown (default), asciidoc, csv, or confluence-markup (converts markdown to wiki markup)',
    'markdown'
  )
  .option('--toc', 'Generate table of contents')
  .option('--inline-cards', 'Parse inline cards')
  .option('--upload-images', 'Upload images to Confluence')
  .option('--use-official-schema', 'Validate against official ADF schema')
  .option('--instance-type <type>', 'Confluence instance type (cloud or server)', 'cloud')
  .option('--macro-format <format>', 'Use macro format instead of ADF (markdown or html)')
  .option('--validate', 'Enable wiki markup validation before upload')
  .option(
    '--mermaid-format <format>',
    'Mermaid rendering: native (default, uses Confluence built-in ~9.x) or html (uses latest from CDN)'
  )
  .option('--mermaid-version <version>', 'Mermaid.js version for CDN (e.g., 11, 10.9.0)', '11')
  .option(
    '--mermaid-theme <theme>',
    'Mermaid theme: default, dark, forest, neutral, base',
    'default'
  )
  .option('--mermaid-config <json>', 'Custom Mermaid config as JSON string')
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
        macroFormat?: 'markdown' | 'html';
      };

      const metadata: PushMetadata = {
        space: undefined,
        parentId: undefined,
        title: options.title,
        pageId: options.pageId,
        labels: [],
        macroFormat: options.macroFormat,
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
            metadata.pageId = options.pageId || frontMatterMetadata.pageId;
            metadata.labels = frontMatterMetadata.labels || [];
            // Command line option has priority, then front matter
            metadata.macroFormat =
              options.macroFormat !== undefined
                ? options.macroFormat
                : frontMatterMetadata.macroFormat;
          }
        }

        // Parse mermaid config if provided
        let mermaidConfig: Record<string, unknown> | undefined;
        if (options.mermaidConfig) {
          try {
            mermaidConfig = JSON.parse(options.mermaidConfig);
          } catch (e) {
            console.error('Error: Invalid JSON in --mermaid-config');
            process.exit(1);
          }
        }

        // Convert with metadata handling
        adf = await convertFile(file, format, {
          generateToc: options.toc,
          parseInlineCards: options.inlineCards,
          uploadImages: options.uploadImages,
          useOfficialSchema: options.useOfficialSchema,
          macroFormat: metadata.macroFormat,
          mermaidFormat: options.mermaidFormat,
          mermaidVersion: options.mermaidVersion,
          mermaidTheme: options.mermaidTheme as MermaidTheme,
          mermaidConfig,
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
      const pageIdParam = metadata.pageId ? String(metadata.pageId) : undefined;

      // Determine content format based on file type and content
      let content: { format: 'adf'; data: ADFEntity } | { format: 'wiki'; data: string };

      // Check if this is raw wiki markup (.confluence or .wiki files)
      if (file.endsWith('.confluence') || file.endsWith('.wiki')) {
        // For .confluence files, read the raw content directly
        const wikiContent = await fs.readFile(file, 'utf-8');
        content = { format: 'wiki', data: wikiContent };

        if (isDebugMode) {
          console.log('DEBUG: Detected raw wiki markup file, using wiki format');
        }

        // Validate wiki markup only if explicitly enabled
        if (options.validate) {
          const validationResult = validateWikiMarkup(wikiContent);
          if (!validationResult.valid || validationResult.warnings.length > 0) {
            console.log('\n⚠️  Wiki Markup Validation Issues:\n');
            console.log(formatValidationResults(validationResult));

            if (!validationResult.valid) {
              console.log('\n❌ Validation failed. Please fix the errors above before pushing.');
              process.exit(1);
            }

            console.log('\n⚠️  Proceeding with warnings...\n');
          }
        }
      } else {
        content = { format: 'adf', data: adf };
      }

      let pageResponse = await client.createOrUpdatePage({
        spaceKey,
        title: pageTitle,
        content,
        parentId,
        pageId: pageIdParam,
        labels: metadata.labels,
      });

      if (isDebugMode) {
        console.log('DEBUG: Response from createOrUpdatePage:', pageResponse);
      }

      // Use type assertion to access properties safely
      const responseId =
        typeof pageResponse === 'object' && pageResponse && 'id' in pageResponse
          ? (pageResponse as { id: string }).id
          : String(pageResponse);

      // Process images if content is wiki markup and upload-images option is enabled
      if (content.format === 'wiki' && options.uploadImages) {
        const wikiContent = content.data;
        const baseDir = path.dirname(path.resolve(file));

        if (isDebugMode) {
          console.log('DEBUG: Processing wiki markup images...');
          console.log(`DEBUG: Base directory: ${baseDir}`);
        }

        // Check if there are any images with paths to process
        const hasImagesToProcess = /!([^!]*[/\\][^!]*)!/g.test(wikiContent);

        if (hasImagesToProcess) {
          console.log('Processing and uploading images...');

          try {
            const processedWikiContent = await client.processWikiMarkupImages(
              wikiContent,
              responseId,
              baseDir
            );

            // Update the page with processed content (images uploaded, paths corrected)
            if (processedWikiContent !== wikiContent) {
              if (isDebugMode) {
                console.log('DEBUG: Updating page with processed image references');
              }

              // Get current page to get version number
              const currentPage = await client.getPage(responseId);
              const currentVersion = currentPage.version?.number || 1;

              pageResponse = await client.updatePage(
                responseId,
                pageTitle,
                {
                  type: 'doc',
                  version: 1,
                  content: [
                    {
                      type: 'wiki-markup',
                      content: [{ type: 'text', text: processedWikiContent }],
                    },
                  ],
                },
                currentVersion + 1
              );

              console.log('✓ Images uploaded and references updated');
            }
          } catch (error) {
            console.warn('⚠️  Warning: Failed to process images:', error);
            // Continue even if image processing fails
          }
        } else if (isDebugMode) {
          console.log('DEBUG: No images with paths found in wiki markup');
        }
      }

      console.log(`Successfully pushed to Confluence (Page ID: ${responseId})`);

      // Build the complete URL from the response
      let pageUrl = 'Not available';
      const typedPageId = pageResponse as { _links?: { webui?: string; base?: string } };
      if (typedPageId._links?.webui && typedPageId._links?.base) {
        pageUrl = `${typedPageId._links.base}${typedPageId._links.webui}`;
      } else if (typedPageId._links?.webui) {
        // If no base URL is provided, use the configured URL
        const config = await getConfluenceConfig();
        pageUrl = `${config.url}${typedPageId._links.webui}`;
      }

      console.log(`Page URL: ${pageUrl}`);
    } catch (error: unknown) {
      logError('Push to Confluence failed', error);
      process.exit(1);
    }
  });

program.parse();
