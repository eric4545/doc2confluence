#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { getConfluenceConfig, getParentPageId, validateSpaceKey } from './config';
import type { ConfluenceInstanceType } from './confluence';
import {
  ConfluenceClient,
  findLocalAdfMediaNodes,
  findLocalWikiImageRefs,
  ImageUploadError,
} from './confluence';
import { convertFile, type InputFormat } from './formats';
import { parseMarkdownFile } from './metadata';
import { assertContentId, IMAGE_EXTENSIONS, resolveLocalAsset } from './security';
import type { ADFEntity } from './types';
import { formatValidationResults, validateWikiMarkup } from './wiki-markup-validator';

/** Confluence Server default per-attachment upload cap. Files larger than this fail with HTTP 413. */
const SERVER_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Per-attachment size cap for the image pre-check. CONFLUENCE_ATTACHMENT_MAX_MB overrides it
 * (0 disables the check); otherwise Server uses its ~2 MB default and Cloud is not capped.
 */
function getAttachmentMaxBytes(instanceType: ConfluenceInstanceType): number | null {
  const override = process.env.CONFLUENCE_ATTACHMENT_MAX_MB;
  if (override !== undefined && override !== '') {
    const mb = Number(override);
    if (!Number.isFinite(mb) || mb < 0) {
      throw new Error(
        `Invalid CONFLUENCE_ATTACHMENT_MAX_MB "${override}": expected a number of MB`
      );
    }
    return mb === 0 ? null : mb * 1024 * 1024;
  }
  return instanceType === 'server' ? SERVER_ATTACHMENT_MAX_BYTES : null;
}

/** The wiki markup text of an ADF doc produced by the confluence-markup format, if it is one. */
function getWikiMarkupText(adf: ADFEntity): string | null {
  if (adf?.type !== 'doc' || adf.content?.length !== 1 || adf.content[0].type !== 'wiki-markup') {
    return null;
  }
  const text = adf.content[0].content?.[0]?.text;
  return typeof text === 'string' ? text : null;
}

/**
 * Check every local image the push would upload: it must stay inside the document/working
 * directory, exist, and fit under the attachment cap. Returns human-readable problems.
 */
async function precheckLocalImages(
  imageRefs: string[],
  baseDir: string,
  maxBytes: number | null
): Promise<string[]> {
  const problems: string[] = [];
  for (const ref of imageRefs) {
    let full: string;
    try {
      full = resolveLocalAsset(ref, baseDir, { extensions: IMAGE_EXTENSIONS, kind: 'image' });
    } catch (error) {
      problems.push(`${ref} — ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    try {
      const stat = await fs.stat(full);
      if (maxBytes !== null && stat.size > maxBytes) {
        problems.push(
          `${ref} — ${(stat.size / (1024 * 1024)).toFixed(1)} MB exceeds the Confluence attachment cap (${(maxBytes / (1024 * 1024)).toFixed(1)} MB; set CONFLUENCE_ATTACHMENT_MAX_MB to change). Compress it before publishing.`
        );
      }
    } catch {
      problems.push(`${ref} — file not found at ${full}`);
    }
  }
  return problems;
}

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
}

function createPlaceholderDocument(message = 'Uploading content...'): ADFEntity {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: message }],
      },
    ],
  };
}

function derivePageTitle(adf: ADFEntity, file: string, explicitTitle?: string): string {
  if (explicitTitle) {
    return explicitTitle;
  }

  if (adf?.content) {
    const firstHeading = adf.content.find(
      (node: ADFEntity) => node.type === 'heading' && node.content && node.content.length > 0
    );

    if (firstHeading?.content) {
      const text = firstHeading.content
        .filter((c: ADFEntity) => c.type === 'text')
        .map((c: ADFEntity) => c.text)
        .join('');

      if (text) {
        return text;
      }
    }
  }

  return path.basename(file, path.extname(file));
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
        macroFormat: options.macroFormat,
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

        // Convert with metadata handling
        adf = await convertFile(file, format, {
          generateToc: options.toc,
          parseInlineCards: options.inlineCards,
          uploadImages: false,
          useOfficialSchema: options.useOfficialSchema,
          macroFormat: metadata.macroFormat,
          instanceType: config.instanceType,
        });
      }

      // Validate space key and parent ID, potentially using metadata values
      const spaceKey = validateSpaceKey(options.space || metadata.space || config.defaultSpace);
      // IDs can come from the document's front matter and end up in REST URL paths.
      const parentId = assertContentId(
        await getParentPageId(options.parent || metadata.parentId || config.defaultParentId),
        'parent page ID'
      );
      metadata.pageId = assertContentId(metadata.pageId, 'page ID');

      const isRawWikiFile = file.endsWith('.confluence') || file.endsWith('.wiki');

      // Fail fast: verify local image references before any page write (including the
      // placeholder page below). An image that fails to upload after the page is published
      // renders as a broken "Unknown Attachment" reference.
      if (options.uploadImages) {
        const wikiSource = isRawWikiFile
          ? await fs.readFile(file, 'utf-8')
          : getWikiMarkupText(adf);
        const imageRefs =
          wikiSource !== null
            ? findLocalWikiImageRefs(wikiSource)
            : Array.from(
                new Set(
                  findLocalAdfMediaNodes(adf).map((node) => (node.attrs as { url: string }).url)
                )
              );
        const problems = await precheckLocalImages(
          imageRefs,
          path.dirname(path.resolve(file)),
          getAttachmentMaxBytes(config.instanceType)
        );
        if (problems.length > 0) {
          console.error('❌ Image pre-check failed — no page was created or updated:');
          for (const problem of problems) {
            console.error(`   - ${problem}`);
          }
          process.exit(1);
        }
      }

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

      const pageTitle = derivePageTitle(adf, file, metadata.title);
      if (isDebugMode) {
        console.log(`DEBUG: Using page title: "${pageTitle}"`);
      }

      let targetPageId = metadata.pageId ? String(metadata.pageId) : undefined;
      if (options.uploadImages && !file.endsWith('.adf.json') && !isRawWikiFile) {
        if (!targetPageId) {
          const existingPage = await client.getPageByTitle(spaceKey, pageTitle, parentId);
          if (existingPage?.id) {
            targetPageId = existingPage.id;
            if (isDebugMode) {
              console.log(`DEBUG: Reusing existing page for image uploads: ${targetPageId}`);
            }
          }
        }

        if (!targetPageId) {
          if (isDebugMode) {
            console.log('DEBUG: Creating placeholder page to obtain page ID for image uploads');
          }

          const placeholderPage = await client.createPage(
            spaceKey,
            pageTitle,
            createPlaceholderDocument(),
            parentId
          );
          targetPageId = placeholderPage.id;
        }

        const format = options.format as InputFormat;
        adf = await convertFile(file, format, {
          generateToc: options.toc,
          parseInlineCards: options.inlineCards,
          uploadImages: true,
          useOfficialSchema: options.useOfficialSchema,
          macroFormat: metadata.macroFormat,
          instanceType: config.instanceType,
          basePath: path.dirname(path.resolve(file)),
          confluenceClient: client,
          spaceKey,
          pageId: targetPageId,
        });
      }

      if (isDebugMode) {
        console.log(`DEBUG: Pushing to Confluence. SpaceKey: ${spaceKey}, Title: ${pageTitle}`);
      }

      const pageIdParam = targetPageId;

      // Determine content format based on file type and content
      let content: { format: 'adf'; data: ADFEntity } | { format: 'wiki'; data: string };

      // Check if this is raw wiki markup (.confluence or .wiki files)
      if (isRawWikiFile) {
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

      // Process images if content is wiki markup (a raw .wiki/.confluence file, or markdown
      // converted with --format confluence-markup) and upload-images option is enabled.
      // Upload failures propagate: the page exists but its images are broken, so exit non-zero.
      const wikiContent =
        content.format === 'wiki' ? content.data : getWikiMarkupText(content.data);
      if (wikiContent !== null && options.uploadImages) {
        const baseDir = path.dirname(path.resolve(file));

        if (isDebugMode) {
          console.log('DEBUG: Processing wiki markup images...');
          console.log(`DEBUG: Base directory: ${baseDir}`);
        }

        if (findLocalWikiImageRefs(wikiContent).length > 0) {
          console.log('Processing and uploading images...');

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
        } else if (isDebugMode) {
          console.log('DEBUG: No images with paths found in wiki markup');
        }
      } else if (content.format === 'adf' && options.uploadImages) {
        // Upload locally-referenced images now that the page (and its ID) exists, then
        // rewrite the ADF media nodes to point at the uploaded attachments.
        const baseDir = path.dirname(path.resolve(file));

        if (isDebugMode) {
          console.log('DEBUG: Processing ADF images...');
          console.log(`DEBUG: Base directory: ${baseDir}`);
        }

        const { changed } = await client.processAdfImages(content.data, responseId, baseDir);

        if (changed) {
          console.log('Processing and uploading images...');

          // Get current page to get version number
          const currentPage = await client.getPage(responseId);
          const currentVersion = currentPage.version?.number || 1;

          pageResponse = await client.updatePage(
            responseId,
            pageTitle,
            content.data,
            currentVersion + 1
          );

          console.log('✓ Images uploaded and references updated');
        } else if (isDebugMode) {
          console.log('DEBUG: No local images found in ADF content');
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
      if (error instanceof ImageUploadError && !isDebugMode) {
        console.error(`❌ ${error.message}`);
      } else {
        logError('Push to Confluence failed', error);
      }
      process.exit(1);
    }
  });

program.parse();
