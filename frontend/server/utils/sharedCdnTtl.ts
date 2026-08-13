/**
 * How long a CDN may hold a shared copy, decided from the path.
 *
 * PER PATH, not one number, because the pages do not age alike and a single
 * constant forces the shortest one on all of them. Corpus permalinks are the
 * whole reason to want a long TTL and search results are the reason not to:
 *
 *   /:locale/sentence/:id   one segment, addressed by immutable public id. Its
 *                           text changes only when a moderator edits it, which
 *                           is rare and never urgent to the tenth reader.
 *   /:locale/search/*       a query against the whole corpus. Goes stale the
 *                           moment anything is imported, and "I added it and it
 *                           is not there" is the complaint that follows. It
 *                           shares the hour today; it is the one to shorten
 *                           first if that complaint arrives.
 *
 * The default stays short on purpose. It covers the locale home and the media
 * pages, which carry "recently added" surfaces -- and `/api/home/recent-media`
 * is itself only `swr: 300` in nuxt.config, so a longer HTML TTL here would
 * promise a freshness the data behind it does not have.
 *
 * Lives beside `visitorCacheTier` rather than inside the plugin so it can be
 * tested without Nitro's auto-imports: the plugin module cannot be imported
 * outside a Nitro runtime, and this is the part worth asserting on.
 */
export const SHARED_CDN_MAX_AGE_DEFAULT = 300;
export const SHARED_CDN_MAX_AGE_SENTENCE = 60 * 60;
export const SHARED_CDN_MAX_AGE_SEARCH = 60 * 60;

/**
 * Locale prefix is stripped exactly the way `isPrivatePath` does it, and for
 * the same reason: segment-aware, so `/entries/...` is not read as `/en`.
 */
export function sharedCdnMaxAge(path: string): number {
  const withoutLocale = path.replace(/^\/(en|es|ja)(?=\/|$)/, '') || '/';

  if (withoutLocale.startsWith('/sentence/')) return SHARED_CDN_MAX_AGE_SENTENCE;
  if (withoutLocale === '/search' || withoutLocale.startsWith('/search/')) return SHARED_CDN_MAX_AGE_SEARCH;

  return SHARED_CDN_MAX_AGE_DEFAULT;
}
