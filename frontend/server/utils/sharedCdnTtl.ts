// Use longer TTLs for corpus permalinks/search than for recently-added surfaces. Search is the first to shorten
// if imports appear stale; the default matches recent-media freshness.
export const SHARED_CDN_MAX_AGE_DEFAULT = 300;
export const SHARED_CDN_MAX_AGE_SENTENCE = 60 * 60;
export const SHARED_CDN_MAX_AGE_SEARCH = 60 * 60;

// Keep non-production cache gating exercised without letting staging/E2E reads see the previous build for an hour.
export const SHARED_CDN_MAX_AGE_NON_PROD = 10;

// Strip locale prefixes at segment boundaries; pass environment explicitly to avoid Nitro runtime coupling.
export function sharedCdnMaxAge(path: string, environment?: string): number {
  const ttl = ttlForPath(path);
  return environment === 'production' ? ttl : Math.min(ttl, SHARED_CDN_MAX_AGE_NON_PROD);
}

function ttlForPath(path: string): number {
  const withoutLocale = path.replace(/^\/(en|es|ja|zh|zh-hant|id|pt-BR)(?=\/|$)/, '') || '/';

  if (withoutLocale.startsWith('/sentence/')) return SHARED_CDN_MAX_AGE_SENTENCE;
  if (withoutLocale === '/search' || withoutLocale.startsWith('/search/')) return SHARED_CDN_MAX_AGE_SEARCH;

  return SHARED_CDN_MAX_AGE_DEFAULT;
}
