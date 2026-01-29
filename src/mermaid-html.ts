/**
 * Mermaid HTML Template Generator
 *
 * This module generates HTML templates for upgrading Mermaid.js version
 * in Confluence pages. Instead of replacing each mermaid block, we add
 * a single script loader that upgrades the Mermaid version globally.
 */

export type MermaidTheme = 'default' | 'dark' | 'forest' | 'neutral' | 'base';

export interface MermaidHtmlOptions {
  /** Mermaid.js version for CDN (e.g., '11', '10.9.0'). Default: '11' */
  version?: string;
  /** Mermaid theme. Default: 'default' */
  theme?: MermaidTheme;
  /** Custom Mermaid configuration object */
  config?: Record<string, unknown>;
  /** Custom CDN URL (overrides default jsdelivr CDN) */
  cdnUrl?: string;
}

const DEFAULT_VERSION = '11';
const DEFAULT_THEME: MermaidTheme = 'default';
const DEFAULT_CDN_URL = 'https://cdn.jsdelivr.net/npm/mermaid@{version}/dist/mermaid.min.js';

/**
 * Build the CDN URL with the specified version
 */
function buildCdnUrl(options: MermaidHtmlOptions): string {
  const version = options.version || DEFAULT_VERSION;
  const baseUrl = options.cdnUrl || DEFAULT_CDN_URL;
  return baseUrl.replace('{version}', version);
}

/**
 * Serialize custom config to JavaScript object notation
 */
function serializeConfig(config: Record<string, unknown> | undefined): string {
  if (!config || Object.keys(config).length === 0) {
    return '';
  }

  // Convert to JSON and remove outer braces for inline object properties
  const jsonStr = JSON.stringify(config, null, 2);
  // Remove first and last braces, and adjust indentation
  const lines = jsonStr.split('\n');
  if (lines.length > 2) {
    // Multi-line config
    return lines
      .slice(1, -1)
      .map((line) => line.replace(/^ {2}/, ''))
      .join('\n      ');
  }
  // Single line or empty
  return jsonStr.slice(1, -1).trim();
}

/**
 * Generate an HTML script loader that upgrades Mermaid.js to the latest version.
 * This script should be added once per page (typically at the end) and will:
 * 1. Load the specified Mermaid.js version from CDN
 * 2. Re-initialize and re-render all mermaid diagrams on the page
 *
 * Usage: Add this in an {html} macro at the end of your Confluence page.
 * The existing {markdown} macros with mermaid code blocks will be re-rendered
 * with the new Mermaid version.
 *
 * @param options - Configuration options for the Mermaid upgrade
 * @returns HTML string with script loader for Confluence HTML macro
 */
export function generateMermaidUpgradeScript(options: MermaidHtmlOptions = {}): string {
  const version = options.version || DEFAULT_VERSION;
  const theme = options.theme || DEFAULT_THEME;
  const cdnUrl = buildCdnUrl(options);
  const customConfigStr = serializeConfig(options.config);

  // Build the config object string
  const configParts = ['startOnLoad: false', `theme: '${theme}'`, "securityLevel: 'loose'"];

  if (customConfigStr) {
    configParts.push(customConfigStr);
  }

  const configStr = configParts.join(',\n      ');

  return `<script>
(function() {
  // Mermaid.js Upgrade Script - Loads v${version} from CDN
  // This overrides Confluence's built-in Mermaid (~9.x) with the latest version

  function upgradeMermaid() {
    // Find all mermaid code blocks rendered by Confluence's markdown macro
    var mermaidBlocks = document.querySelectorAll('pre.mermaid, code.language-mermaid, .mermaid');

    if (mermaidBlocks.length === 0) {
      console.log('Mermaid upgrade: No mermaid blocks found on page');
      return;
    }

    console.log('Mermaid upgrade: Found ' + mermaidBlocks.length + ' diagram(s), upgrading to v${version}...');

    // Initialize with custom config
    mermaid.initialize({
      ${configStr}
    });

    // Re-render all mermaid diagrams
    mermaid.run({
      nodes: mermaidBlocks
    }).then(function() {
      console.log('Mermaid upgrade: Successfully rendered ' + mermaidBlocks.length + ' diagram(s)');
    }).catch(function(err) {
      console.error('Mermaid upgrade: Error rendering diagrams:', err);
    });
  }

  // Load Mermaid.js from CDN
  var script = document.createElement('script');
  script.src = '${cdnUrl}';
  script.onload = function() {
    console.log('Mermaid upgrade: Loaded Mermaid.js v${version}');
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', upgradeMermaid);
    } else {
      // Small delay to ensure Confluence's rendering is complete
      setTimeout(upgradeMermaid, 100);
    }
  };
  script.onerror = function() {
    console.error('Mermaid upgrade: Failed to load Mermaid.js v${version} from CDN');
  };
  document.head.appendChild(script);
})();
</script>`;
}

/**
 * Generate the wiki markup for the mermaid upgrade script
 * This wraps the script in {html} macro for direct use in wiki markup
 *
 * @param options - Configuration options for the Mermaid upgrade
 * @returns Wiki markup string with {html} macro containing the upgrade script
 */
export function generateMermaidUpgradeWikiMarkup(options: MermaidHtmlOptions = {}): string {
  const script = generateMermaidUpgradeScript(options);
  return `{html}${script}{html}`;
}

// Legacy exports for backwards compatibility
export { generateMermaidUpgradeScript as generateMermaidHtml };

/**
 * @deprecated Use generateMermaidUpgradeScript instead
 */
export function generateMermaidHtmlInline(_mermaidCode: string): string {
  console.warn(
    'generateMermaidHtmlInline is deprecated. Use generateMermaidUpgradeScript instead.'
  );
  return generateMermaidUpgradeScript();
}
