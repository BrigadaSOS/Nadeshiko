import { env } from '~~/config/env';
import { ipRateLimit, type IpRateLimitOptions } from '~~/server/utils/ipRateLimit';

// Throttle HTML renders per IP. Excludes the static redirects (00-locale,
// search-redirect) and the API proxy (v1/*), the health endpoint, and Nuxt's
// internal asset paths.
const SKIP_PREFIXES = [
  '/_nuxt/',
  '/_i18n/',
  '/api/',
  '/v1/',
  '/__sitemap__',
  '/sitemap',
  '/docs/',
  '/.well-known/',
  '/media/',
  '/favicon.ico',
  '/robots.txt',
  '/opensearch.xml',
  '/up',
];
const SKIP_EXACT = new Set(['/up', '/robots.txt', '/opensearch.xml', '/favicon.ico']);

const HTML_LIMIT: IpRateLimitOptions = {
  route: 'html',
  windowMs: 60_000,
  // ~1 req/s sustained per IP. Real users don't hit this. Bots do.
  max: env.NUXT_RATE_LIMIT_HTML_MAX,
};

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event);
  const path = url.pathname;

  if (SKIP_EXACT.has(path)) return;
  if (SKIP_PREFIXES.some((p) => path.startsWith(p))) return;

  const err = await ipRateLimit(event, HTML_LIMIT);
  if (err) throw err;
});
