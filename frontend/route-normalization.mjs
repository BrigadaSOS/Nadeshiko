const ID_PATTERN = /^[0-9]+$|^[0-9a-f]{8,}$/i;
const NANOID_PATTERN = /^[A-Za-z0-9_-]{8,}$/;

const STATIC_PAGES = new Set([
  '/', '/blog', '/media', '/stats', '/stats/words',
  '/about', '/privacy', '/terms-and-conditions', '/dmca',
  '/search', '/api/v1/docs',
]);

const ROUTE_PATTERNS = [
  [/^\/sentence\/[^/]+$/, '/sentence/:id'],
  [/^\/collection\/[^/]+$/, '/collection/:id'],
  [/^\/s\/[^/]+$/, '/s/:id'],
  [/^\/search\/[^/]+$/, '/search/:query'],
  [/^\/blog\/[^/]+$/, '/blog/:slug'],
  [/^\/admin\//, '/admin/:slug'],
  [/^\/settings\//, '/settings/:slug'],
  [/^\/user\//, '/user/:slug'],
];

const IGNORED_PREFIXES = ['/_nuxt/', '/_i18n/', '/__nuxt'];
const IGNORED_PATHS = ['/up', '/favicon.ico'];

function isIdSegment(seg) {
  if (ID_PATTERN.test(seg)) return true;
  if (seg.length >= 8 && NANOID_PATTERN.test(seg) && /[0-9]/.test(seg) && /[A-Za-z]/.test(seg)) return true;
  return false;
}

export function normalizeRoute(url) {
  const path = url.split('?')[0];

  if (STATIC_PAGES.has(path)) return path;

  for (const [pattern, template] of ROUTE_PATTERNS) {
    if (pattern.test(path)) return template;
  }

  if (path.startsWith('/v1/') || path.startsWith('/media/')) {
    return path
      .split('/')
      .map((s) => (s !== '' && isIdSegment(s) ? ':id' : s))
      .join('/');
  }

  return '/__other';
}

export function isIgnoredPath(url) {
  const path = url.split('?')[0];
  if (IGNORED_PATHS.includes(path)) return true;
  return IGNORED_PREFIXES.some((prefix) => path.startsWith(prefix));
}
