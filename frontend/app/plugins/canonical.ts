import { INDEXED_LOCALES, LOCALE_LANGUAGE_TAGS } from '~/utils/i18n';
import { buildSentencePath, canonicalPath, splitLocalePrefix, withLocalePrefix } from '~/utils/routes';

const CANONICAL_REWRITES: Record<string, (query: Record<string, string>) => string> = {
  '/search/sentence': (q) => (q.query ? buildSentencePath(q.query) : '/search/sentence'),
};

const CANONICAL_PARAMS: Record<string, string[]> = {
  '/search': ['media', 'episode', 'category'],
  // Keep parameters that change the result set: catalogue query/category, title episode, and catalogue
  // cursor. Exclude sort, which only reorders the same content.
  '/media': ['query', 'category', 'episode', 'cursor'],
  // Tier and filter define distinct word sets. Preserve the sitemap's COVERED filter rather than
  // canonicalizing it to noindexed word results.
  '/stats/words': ['tier', 'filter'],
};

/**
 * Which locale answers `hreflang="x-default"` -- the copy a search engine shows
 * a reader whose language matches none of ours. Same default as `i18n.defaultLocale`.
 */
const X_DEFAULT_LOCALE = 'en';

export default defineNuxtPlugin(() => {
  const route = useRoute();
  const { url: siteUrl } = useSiteConfig();

  /** Resolve one URL for both canonical and `og:url`, including canonical facets. */
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
 * Build hreflang from the normalized canonical path, not router serialization that adds escaping layers.
 * Match i18n link ids for head deduplication and retain literal rel types for Unhead. Unprefixed paths have
 * no locale variants to advertise.
 */
function alternates(siteUrl: string, localePrefix: string, localizedPath: string, suffix: string) {
  if (!localePrefix) return [];

  // INDEXED_LOCALES, not SUPPORTED_LOCALES: `ja` renders but is `robots: false`
  // everywhere, and an hreflang set that points at noindexed URLs is a set that
  // contradicts itself. See the comment on INDEXED_LOCALES.
  const links = INDEXED_LOCALES.map((locale) => ({
    id: `i18n-alt-${locale}`,
    rel: 'alternate' as const,
    hreflang: LOCALE_LANGUAGE_TAGS[locale],
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
