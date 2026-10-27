import { realpathSync } from 'node:fs';
import path from 'node:path';

/** File extensions that may be uploaded as image attachments. */
export const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
  '.ico',
  '.avif',
]);

export function hasImageExtension(ref: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(ref).toLowerCase());
}

function realOrResolved(p: string): string {
  const resolved = path.resolve(p);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * Resolve a file referenced from a document (image, CSV import) and make sure it stays
 * inside the document's directory or the current working directory. Symlinks are
 * resolved first, so a link pointing outside those roots is rejected too.
 *
 * Documents are often written by someone other than the person (or CI job) publishing
 * them; without this check `![x](../../.env)` or `![x](/proc/self/environ)` would read
 * local secrets and publish them to Confluence.
 */
export function resolveLocalAsset(
  ref: string,
  baseDir: string,
  options: { extensions?: Set<string>; kind?: string } = {}
): string {
  const kind = options.kind || 'file';
  if (options.extensions && !options.extensions.has(path.extname(ref).toLowerCase())) {
    throw new Error(
      `Refusing to read ${kind} "${ref}": extension must be one of ${Array.from(options.extensions).join(', ')}`
    );
  }

  const target = realOrResolved(path.resolve(baseDir, ref));
  const roots = [baseDir, process.cwd()].map(realOrResolved);
  if (!roots.some((root) => isWithin(root, target))) {
    throw new Error(
      `Refusing to read ${kind} "${ref}": it resolves to ${target}, outside the document directory (${roots[0]}) and the working directory (${roots[1]})`
    );
  }
  return target;
}

/** Escape text for use inside an XML/HTML attribute value or element body. */
export function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Wrap text in a CDATA section, splitting any `]]>` so the content cannot terminate it early. */
export function cdata(text: string): string {
  return `<![CDATA[${text.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

/** Allow only http(s), mailto, and relative/anchor links; anything else becomes `#`. */
export function safeHref(href: unknown): string {
  if (typeof href !== 'string' || href.trim() === '') {
    return '#';
  }
  // Strip control characters and whitespace browsers ignore when parsing a scheme.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control-char strip
  const normalized = href.replace(/[\u0000- ]/g, '');
  const scheme = normalized.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (scheme && !['http', 'https', 'mailto'].includes(scheme[1].toLowerCase())) {
    return '#';
  }
  return href;
}

/** Accept CSS colors of the form #rgb / #rrggbb / #rrggbbaa or a bare color name. */
export function safeColor(color: unknown): string | null {
  if (typeof color !== 'string') return null;
  return /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$|^[a-zA-Z]+$/.test(color)
    ? color
    : null;
}

/** Confluence content IDs are numeric. Reject anything else before it reaches a URL path. */
export function assertContentId(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const id = String(value).trim();
  if (!/^\d+$/.test(id)) {
    throw new Error(`Invalid ${label} "${id}": Confluence content IDs must be numeric.`);
  }
  return id;
}

/**
 * Refuse to send credentials over plain HTTP unless the target is loopback or the user
 * explicitly opts in with CONFLUENCE_ALLOW_INSECURE_HTTP=true.
 */
export function assertSecureUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid CONFLUENCE_URL "${url}"`);
  }
  if (parsed.protocol === 'https:') return;
  if (parsed.protocol !== 'http:') {
    throw new Error(`Unsupported CONFLUENCE_URL protocol "${parsed.protocol}" (use https)`);
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (loopback || process.env.CONFLUENCE_ALLOW_INSECURE_HTTP === 'true') return;
  throw new Error(
    `Refusing to send Confluence credentials over plain HTTP (${parsed.origin}). Use https, or set CONFLUENCE_ALLOW_INSECURE_HTTP=true if you accept the risk.`
  );
}
