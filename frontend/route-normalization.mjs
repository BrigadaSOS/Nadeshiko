const ID_PATTERN = /^[0-9]+$|^[0-9a-f]{8,}$/i;
const NANOID_PATTERN = /^[A-Za-z0-9_-]{8,}$/;
const COMPOSITE_ID_PATTERN = /^[0-9]+(?:[_-][0-9]+)+$/;

// Keep in sync with the `locales` codes in nuxt.config.ts. Locale-prefixed
// paths are the bulk of real page traffic (`/ja/sentence/<id>`), and every one
// of them used to miss STATIC_PAGES and the anchored ROUTE_PATTERNS below and
// fall through to `/__other` -- 98% of frontend requests landed in that one
// bucket, which is why the APM endpoint list had nothing to show.
// Exported only so server/utils/routeNormalization.test.ts can assert it still
// matches nuxt.config.ts -- a locale added there and forgotten here would send
// that locale's entire traffic back into `/__other`, silently.
export const LOCALES = new Set(['en', 'es', 'ja']);

const STATIC_PAGES = new Set([
  '/', '/blog', '/media', '/stats', '/stats/words',
  '/about', '/privacy', '/terms-and-conditions', '/dmca',
  '/search', '/api/v1/docs',
  // The signed-in area. Peeling the locale prefix rescued the public pages but
  // left every one of these in `/__other`, because none of them matched a
  // STATIC_PAGES entry or an anchored pattern -- the authenticated surface, the
  // one worth having latency on, was the last thing still invisible.
  '/user', '/user/activity', '/user/collections', '/user/developer',
  // `/user/media` is the combined starred + hidden tab. The two paths beside it
  // are the tabs it replaced and now 301 to it; they keep their own series so a
  // still-linked bookmark stays visible rather than folding into `/user/:slug`.
  '/user/media', '/user/favorites', '/user/hide-media', '/user/settings', '/user/sync',
  '/user/admin', '/user/admin/agent-activity', '/user/admin/announcement',
  '/user/admin/reports', '/user/admin/users',
  '/settings',
  // Where Shirabe returns a reader after they approve the account link. Its own
  // series rather than `/__other`: it is the one page in the flow that can fail
  // in a way nobody reports, because a reader who lands on an error here simply
  // gives up on connecting.
  '/link/shirabe/callback',
  // The unsubscribe confirmation. Its own series for the same reason as the
  // Shirabe callback: a reader who lands here and cannot complete it does not
  // write in to say so, they press the spam button instead -- which costs the
  // sending reputation that every sign-in link depends on. Folded into
  // `/__other` that failure would be invisible.
  '/unsubscribe',
]);

const ROUTE_PATTERNS = [
  [/^\/sentence\/[^/]+$/, '/sentence/:id'],
  [/^\/collection\/[^/]+$/, '/collection/:id'],
  [/^\/s\/[^/]+$/, '/s/:id'],
  [/^\/search\/[^/]+$/, '/search/:query'],
  [/^\/blog\/[^/]+$/, '/blog/:slug'],
  // Media pages are addressed by slug, and a slug is not id-shaped: it carries
  // no digit and no uppercase, so `isIdSegment` below correctly declines to
  // template it and every title used to become its own label. Measured in
  // production on 2026-08-29: 236 distinct `/:locale/media/<title>` series in
  // 24h, essentially all idle, each carrying a full latency histogram -- one
  // `histogram_quantile` over the frontend fetched 8,850 series against the
  // backend's 1,710. It was inconsistent as well as expensive: a title whose
  // slug happens to contain a digit DID template, so the same page was split
  // across two labelling schemes.
  //
  // Templated to `:id` rather than `:slug` deliberately -- the numeric form
  // already normalizes to `/media/:id` via the fallback, so this merges into
  // the existing series instead of opening a second one beside it.
  [/^\/media\/[^/]+$/, '/media/:id'],
  [/^\/admin\//, '/admin/:slug'],
  // `/user` and `/settings` are `[...slug]` catch-alls, so an unlisted page
  // under them is routed rather than 404. STATIC_PAGES is checked first and
  // keeps the known ones exact; these bound what an unlisted one can cost to a
  // single series each, the same trade the `/admin/` entry above makes.
  [/^\/user\//, '/user/:slug'],
  [/^\/settings\//, '/settings/:slug'],
];

const IGNORED_PREFIXES = ['/_nuxt/', '/_i18n/', '/__nuxt'];
const IGNORED_PATHS = ['/up', '/favicon.ico'];

function isIdSegment(seg) {
  const bare = seg.replace(/\.[^.]+$/, '');
  if (ID_PATTERN.test(bare)) return true;
  if (COMPOSITE_ID_PATTERN.test(bare)) return true;
  // Public ids are nanoid-shaped. Requiring BOTH cases (the old rule) only
  // caught the ones that happened to be mixed: `gFH5xlsT--zr` templated, but
  // `-OFOANT699SJ` and `-hiojjfbx73y` leaked through as raw label values, one
  // new series per segment id. A digit is the more reliable signal -- real path
  // words ("collections", "covered-words", "magic-link") have none, while a
  // 12-char nanoid almost always does -- so accept a digit OR mixed case.
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

  // Peel a locale prefix and re-apply it as `/:locale`, so `/ja/sentence/x` and
  // `/es/sentence/y` collapse onto one `/:locale/sentence/:id` series instead
  // of both disappearing into `/__other`.
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
