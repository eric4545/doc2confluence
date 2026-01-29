/**
 * Mermaid HTML Template Generator
 *
 * This module generates HTML templates for rendering Mermaid diagrams
 * via Confluence's HTML macro with the latest Mermaid.js from CDN.
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
 * Generate a unique ID for the mermaid container
 */
function generateUniqueId(): string {
  return `mermaid-${Math.random().toString(36).substring(2, 10)}-${Date.now().toString(36)}`;
}

/**
 * Escape HTML entities in mermaid code to prevent XSS
 */
function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => htmlEntities[char] || char);
}

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
      .join('\n        ');
  }
  // Single line or empty
  return jsonStr.slice(1, -1).trim();
}

/**
 * Generate HTML for a single Mermaid diagram
 * This HTML can be used within Confluence's HTML macro
 *
 * @param mermaidCode - The Mermaid diagram code
 * @param options - Configuration options for the HTML generation
 * @returns HTML string ready for Confluence HTML macro
 */
export function generateMermaidHtml(mermaidCode: string, options: MermaidHtmlOptions = {}): string {
  const uniqueId = generateUniqueId();
  const version = options.version || DEFAULT_VERSION;
  const theme = options.theme || DEFAULT_THEME;
  const cdnUrl = buildCdnUrl(options);
  const escapedCode = escapeHtml(mermaidCode.trim());
  const customConfigStr = serializeConfig(options.config);

  // Build the config object string
  const configParts = ['startOnLoad: false', `theme: '${theme}'`, "securityLevel: 'loose'"];

  if (customConfigStr) {
    configParts.push(customConfigStr);
  }

  const configStr = configParts.join(',\n        ');

  return `<div class="mermaid-container" id="${uniqueId}" style="min-height: 100px;">
  <style>
    .mermaid-container .mermaid-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100px;
      color: #666;
      font-style: italic;
    }
    .mermaid-container .mermaid {
      display: none;
    }
    .mermaid-container.mermaid-loaded .mermaid {
      display: block;
    }
    .mermaid-container.mermaid-loaded .mermaid-loading {
      display: none;
    }
  </style>
  <div class="mermaid-loading">Loading diagram...</div>
  <pre class="mermaid">
${escapedCode}
  </pre>
</div>
<script>
(function() {
  var containerId = '${uniqueId}';
  var container = document.getElementById(containerId);

  function initMermaid() {
    if (typeof mermaid === 'undefined') {
      console.error('Mermaid library not loaded');
      return;
    }

    mermaid.initialize({
        ${configStr}
    });

    mermaid.run({
      querySelector: '#' + containerId + ' .mermaid'
    }).then(function() {
      container.classList.add('mermaid-loaded');
    }).catch(function(err) {
      console.error('Mermaid rendering error:', err);
      container.querySelector('.mermaid-loading').textContent = 'Error rendering diagram';
    });
  }

  // Check if Mermaid is already loaded
  if (typeof mermaid !== 'undefined') {
    initMermaid();
  } else if (!window._mermaidLoading) {
    // Load Mermaid from CDN (only once per page)
    window._mermaidLoading = true;
    window._mermaidCallbacks = window._mermaidCallbacks || [];
    window._mermaidCallbacks.push(initMermaid);

    var script = document.createElement('script');
    script.src = '${cdnUrl}';
    script.onload = function() {
      window._mermaidCallbacks.forEach(function(cb) { cb(); });
      window._mermaidCallbacks = [];
    };
    script.onerror = function() {
      console.error('Failed to load Mermaid.js v${version} from CDN');
      container.querySelector('.mermaid-loading').textContent = 'Failed to load diagram library';
    };
    document.head.appendChild(script);
  } else {
    // Mermaid is being loaded, queue callback
    window._mermaidCallbacks = window._mermaidCallbacks || [];
    window._mermaidCallbacks.push(initMermaid);
  }
})();
</script>`;
}

/**
 * Generate HTML for multiple Mermaid diagrams on the same page
 * This optimizes loading by sharing a single script load
 *
 * @param diagrams - Array of mermaid diagram codes
 * @param options - Configuration options for the HTML generation
 * @returns Array of HTML strings, one per diagram
 */
export function generateMultipleMermaidHtml(
  diagrams: string[],
  options: MermaidHtmlOptions = {}
): string[] {
  return diagrams.map((code) => generateMermaidHtml(code, options));
}

/**
 * Generate a minimal HTML snippet for inline usage (without script)
 * Use this when you know Mermaid.js is already loaded on the page
 *
 * @param mermaidCode - The Mermaid diagram code
 * @returns HTML string with just the diagram container
 */
export function generateMermaidHtmlInline(mermaidCode: string): string {
  const uniqueId = generateUniqueId();
  const escapedCode = escapeHtml(mermaidCode.trim());

  return `<div class="mermaid-container" id="${uniqueId}">
  <pre class="mermaid">
${escapedCode}
  </pre>
</div>`;
}
