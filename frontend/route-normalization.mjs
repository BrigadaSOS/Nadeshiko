const ID_PATTERN = /^[0-9]+$|^[0-9a-f]{8,}$/i;
const NANOID_PATTERN = /^[A-Za-z0-9_-]{8,}$/;
const COMPOSITE_ID_PATTERN = /^[0-9]+(?:[_-][0-9]+)+$/;

// Keep locale codes in sync with nuxt.config.ts; missing prefixes collapse that locale's page telemetry
// into /__other. routeNormalization.test.ts checks parity.
export const LOCALES = new Set(['en', 'es', 'ja', 'zh', 'zh-hant', 'id', 'pt-BR']);

const STATIC_PAGES = new Set([
  '/',
  '/blog',
  '/changelog',
  '/media',
  '/roadmap',
  '/stats',
  '/stats/words',
  '/about',
  '/privacy',
  '/terms-and-conditions',
  '/dmca',
  '/search',
  '/api/v1/docs',
  '/user',
  '/user/activity',
  '/user/collections',
  '/user/developer',
  // Retain separate series for legacy tabs that redirect to /user/media so old bookmarks remain observable.
  '/user/media',
  '/user/favorites',
  '/user/hide-media',
  '/user/settings',
  '/user/sync',
  '/user/admin',
  '/user/admin/agent-activity',
  '/user/admin/announcement',
  '/user/admin/reports',
  '/user/admin/users',
  '/user/admin/roadmap',
  '/settings',
  '/auth/callback',
  '/link/shirabe/callback',
  '/link/patreon/callback',
  // Keep unsubscribe failures visible independently; they affect sending reputation.
  '/unsubscribe',
  // Keep legacy email-verification failures visible rather than folding them into generic 404 traffic.
  '/verify',
]);

const ROUTE_PATTERNS = [
  [/^\/sentence\/[^/]+$/, '/sentence/:id'],
  [/^\/collection\/[^/]+$/, '/collection/:id'],
  [/^\/s\/[^/]+$/, '/s/:id'],
  [/^\/search\/[^/]+$/, '/search/:query'],
  [/^\/blog\/[^/]+$/, '/blog/:slug'],
  // Media slugs need an explicit bounded label. Use :id to merge with the existing numeric-media series.
  [/^\/media\/[^/]+$/, '/media/:id'],
  [/^\/admin\//, '/admin/:slug'],
  // Known catch-all pages stay exact via STATIC_PAGES; bound unlisted /user and /settings pages to one series each.
  [/^\/user\//, '/user/:slug'],
  [/^\/settings\//, '/settings/:slug'],
];

const IGNORED_PREFIXES = ['/_nuxt/', '/_i18n/', '/__nuxt'];
const IGNORED_PATHS = ['/up', '/favicon.ico'];

function isIdSegment(seg) {
  const bare = seg.replace(/\.[^.]+$/, '');
  if (ID_PATTERN.test(bare)) return true;
  if (COMPOSITE_ID_PATTERN.test(bare)) return true;
  // Accept digit-bearing or mixed-case nanoids; requiring both cases leaks single-case public IDs into labels.
  if (
    bare.length >= 8 &&
    NANOID_PATTERN.test(bare) &&
    (/[0-9]/.test(bare) || (/[a-z]/.test(bare) && /[A-Z]/.test(bare)))
  )
    return true;
  return false;
}

export function normalizeRoute(url) {
  const path = url.split('?')[0];

  const [, head, ...rest] = path.split('/');
  if (LOCALES.has(head)) {
    const inner = normalizeRoute(rest.length ? `/${rest.join('/')}` : '/');
    if (inner === '/__other') return '/__other';
    return inner === '/' ? '/:locale' : `/:locale${inner}`;
  }

  if (STATIC_PAGES.has(path)) return path;

  for (const [pattern, template] of ROUTE_PATTERNS) {
    if (pattern.test(path)) return template;
  }

  if (path.startsWith('/v1/') || path.startsWith('/media/')) {
    return path
      .split('/')
      .map((s) => {
        if (s === '' || !isIdSegment(s)) return s;
        const dotIdx = s.lastIndexOf('.');
        return dotIdx > 0 ? `:id${s.slice(dotIdx)}` : ':id';
      })
      .join('/');
  }

  return '/__other';
}

export function isIgnoredPath(url) {
  const path = url.split('?')[0];
  if (IGNORED_PATHS.includes(path)) return true;
  return IGNORED_PREFIXES.some((prefix) => path.startsWith(prefix));
}
