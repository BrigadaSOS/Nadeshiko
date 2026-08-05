// Paths that belong to the app itself rather than to any locale. Exported
// because the HTML rate limiter (server/middleware/99-rate-limit-html.ts)
// skips exactly this set too.
export const RESERVED_PREFIXES = [
  '/_nuxt/',
  '/_i18n/',
  '/api/',
  '/v1/',
  '/__sitemap__',
  '/sitemap',
  '/docs/',
  '/.well-known/',
  '/media/',
];

export const RESERVED_EXACT = new Set(['/__nuxt_error', '/up', '/robots.txt', '/opensearch.xml', '/favicon.ico']);

export function isReservedLocalePath(path: string): boolean {
  if (RESERVED_EXACT.has(path)) return true;
  if (RESERVED_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  // Files at root: /github-xxx.png, /logo-xxx.webp, /sitemap-en.xml, etc.
  if (/^\/[^/]+\.[a-zA-Z0-9]+$/.test(path)) return true;
  return false;
}
