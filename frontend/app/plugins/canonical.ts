import { INDEXED_LOCALES } from '~/utils/i18n';
import { buildSentencePath, canonicalPath, splitLocalePrefix, withLocalePrefix } from '~/utils/routes';

const CANONICAL_REWRITES: Record<string, (query: Record<string, string>) => string> = {
  '/search/sentence': (q) => (q.query ? buildSentencePath(q.query) : '/search/sentence'),
};

const CANONICAL_PARAMS: Record<string, string[]> = {
  '/search': ['media', 'episode', 'category'],
  // Both `/media` (the catalogue, filtered by `?query=`) and `/media/<slug>` (one
  // title, optionally narrowed to an episode) match this prefix. `episode` is
  // canonical because a single episode of a title is its own list of sentences,
  // not a view of the whole; `sort` deliberately is not -- it reorders the same
  // set and would multiply every title into as many URLs as there are orders.
  '/media': ['query', 'category', 'episode'],
};

/**
 * Which locale answers `hreflang="x-default"` -- the copy a search engine shows
 * a reader whose language matches none of ours. Same default as `i18n.defaultLocale`.
 */
const X_DEFAULT_LOCALE = 'en';

export default defineNuxtPlugin(() => {
  const route = useRoute();
  const { url: siteUrl } = useSiteConfig();

  /**
   * The one answer to "what is this page's URL", so the canonical and `og:url`
   * cannot give two.
   *
   * They did: the canonical deliberately keeps `media` and `episode` on a
   * faceted search, while `og:url` was never set anywhere and fell back to the
   * path-only default -- one head, two contradictory claims.
   */
  const resolveCanonical = () => {
    // NOT `route.path`, which is one percent-encoding layer deeper than the
    // URL that was requested -- see `canonicalPath`. Emitting that as a link
    // is what turned one search URL into an unbounded family of ever-longer
    // ones, so every href below is built from this and never from route.path.
    const path = canonicalPath(route.path, route.params.query as string | string[] | undefined);
    const { localePrefix, localizedPath } = splitLocalePrefix(path);

    const rewrite = CANONICAL_REWRITES[localizedPath];
    if (rewrite) {
      const queryMap: Record<string, string> = {};
      for (const [k, v] of Object.entries(route.query)) {
        if (typeof v === 'string') queryMap[k] = v;
      }
      return { localePrefix, target: rewrite(queryMap), suffix: '' };
    }

    const allowedParams =
      Object.entries(CANONICAL_PARAMS).find(([prefix]) => localizedPath.startsWith(prefix))?.[1] ?? [];

    const params = new URLSearchParams();
    for (const key of allowedParams) {
      const value = route.query[key];
      if (typeof value === 'string' && value) {
        params.set(key, value);
      }
    }

    const query = params.toString();
    const suffix = query ? `?${query}` : '';

    return { localePrefix, target: localizedPath, suffix };
  };

  const href = () => {
    const { localePrefix, target, suffix } = resolveCanonical();
    return `${siteUrl}${withLocalePrefix(localePrefix, target)}${suffix}`;
  };

  useHead({
    link: () => {
      const { localePrefix, target, suffix } = resolveCanonical();
      return [{ rel: 'canonical', href: href() }, ...alternates(siteUrl, localePrefix, target, suffix)];
    },
    meta: () => [{ property: 'og:url', content: href() }],
  });
});

/**
 * The hreflang set, one entry per locale plus `x-default`.
 *
 * These used to come from `useLocaleHead()`, which `app.vue` now takes no links
 * from at all. The module builds its hrefs from the router's idea of the current
 * path, which carries the extra encoding layer described in `canonicalPath` --
 * so on a search page its four alternates advertised four NEW URLs on every
 * render, three of them under locales nobody had asked for. Fixing the canonical
 * alone would have left three quarters of the loop running.
 *
 * `id` matches the module's own naming so a stray duplicate from either side
 * de-duplicates in `useHead` rather than shipping twice. `as const` on each
 * `rel` is load-bearing for the same reason: widened to `string` these stop
 * matching unhead's hreflang-link shape and fall through to its feed-link one,
 * which demands a `type` an hreflang link must not carry.
 *
 * Nothing is emitted for a path with no locale prefix. Under `strategy: 'prefix'`
 * every page URL carries one, so such a path is not a page whose language
 * variants we can name -- and naming them anyway would invent three URLs.
 */
function alternates(siteUrl: string, localePrefix: string, localizedPath: string, suffix: string) {
  if (!localePrefix) return [];

  // INDEXED_LOCALES, not SUPPORTED_LOCALES: `ja` renders but is `robots: false`
  // everywhere, and an hreflang set that points at noindexed URLs is a set that
  // contradicts itself. See the comment on INDEXED_LOCALES.
  const links = INDEXED_LOCALES.map((locale) => ({
    id: `i18n-alt-${locale}`,
    rel: 'alternate' as const,
    hreflang: locale,
    href: `${siteUrl}${withLocalePrefix(`/${locale}`, localizedPath)}${suffix}`,
  }));

  return [
    ...links,
    {
      id: 'i18n-xd',
      rel: 'alternate' as const,
      hreflang: 'x-default',
      href: `${siteUrl}${withLocalePrefix(`/${X_DEFAULT_LOCALE}`, localizedPath)}${suffix}`,
    },
  ];
}
