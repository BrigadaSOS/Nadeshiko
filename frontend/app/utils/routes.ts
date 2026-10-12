import { SUPPORTED_LOCALES } from '~/utils/i18n';

// Derive prefixes from `SUPPORTED_LOCALES` so adding a locale updates every route parser.
const LOCALE_PREFIXES = SUPPORTED_LOCALES.map((locale) => `/${locale}`);

export function splitLocalePrefix(path: string): { localePrefix: string; localizedPath: string } {
  const localePrefix = LOCALE_PREFIXES.find((prefix) => path === prefix || path.startsWith(`${prefix}/`)) ?? '';
  const localizedPath = localePrefix ? path.slice(localePrefix.length) || '/' : path;
  return { localePrefix, localizedPath };
}

export function withLocalePrefix(localePrefix: string, path: string): string {
  if (!localePrefix) return path;
  return path === '/' ? localePrefix : `${localePrefix}${path}`;
}

export function buildWordSearchPath(word: string): string {
  return `/search/${encodeURIComponent(word)}`;
}

/**
 * Re-run a recent search with query and title scope only; episode, sort and cursor describe a previous
 * position, not the remembered search.
 */
export function buildScopedSearchPath(word: string, mediaPublicId?: string | null): string {
  const path = buildWordSearchPath(word);
  return mediaPublicId ? `${path}?media=${encodeURIComponent(mediaPublicId)}` : path;
}

/**
 * Fold only U+201C/U+201D to Lucene's straight-double-quote phrase delimiter. Other quote-like punctuation
 * remains literal; folding it would invent exact-match intent. Corpus punctuation problems belong in the
 * analyzer.
 */
export function normalizeSearchQuery(raw: string): string {
  return raw.replace(/[\u201C\u201D]/g, '"');
}

/**
 * Decode the raw router param once. Malformed UTF-8 escapes fall back to raw text rather than throwing during
 * page setup; server middleware is the first validation layer.
 */
export function decodeSearchQuery(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Match the backend OpenAPI `SearchQuery.search` limit; longer queries can only produce API 400s. */
export const SEARCH_QUERY_MAX_LENGTH = 500;

/**
 * `isJunkSearchQuery` rejects malformed encoding, decoded paths and terms exceeding the API limit. HTTP
 * redirects collapse crawler-generated URL families before an SSR render.
 */
/** Carry query and hash verbatim; rebuilding `route.query` would introduce another encoding pass. */
export function queryAndHash(fullPath: string): string {
  const cut = fullPath.search(/[?#]/);
  return cut === -1 ? '' : fullPath.slice(cut);
}

/** Bound pathological decoding work while accommodating the observed 68-layer escaped URL family. */
const MAX_SEARCH_DECODE_ROUNDS = 80;

/**
 * Return decoded text only after at least two successful changing decodes. Redirecting over-escaped URLs
 * collapses existing crawler families before canonical/hreflang links can regenerate them. Literal `%41` also
 * becomes `A`: an accepted false positive; incomplete escapes stop decoding.
 */
export function overEscapedSearchQuery(raw: string): string | null {
  let value = raw;
  let rounds = 0;

  while (rounds < MAX_SEARCH_DECODE_ROUNDS) {
    let next: string;
    try {
      next = decodeURIComponent(value);
    } catch {
      break;
    }
    if (next === value) break;
    value = next;
    rounds += 1;
  }

  return rounds >= 2 ? value : null;
}

export function isJunkSearchQuery(raw: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return true;
  }
  return decoded.includes('/') || decoded.length > SEARCH_QUERY_MAX_LENGTH;
}

/**
 * Build search canonicals from the raw query with one decode/encode pass. Router path serialization can add
 * an escaping layer, causing recursive URL families. Other routes only need trailing-slash normalization.
 */
export function canonicalPath(path: string, queryParam: string | ReadonlyArray<string | null> | undefined): string {
  const raw = getStringQueryValue(queryParam);
  const { localePrefix, localizedPath } = splitLocalePrefix(path);
  if (raw === null || !localizedPath.startsWith('/search/')) {
    return stripTrailingSlash(path);
  }
  return withLocalePrefix(localePrefix, buildWordSearchPath(decodeSearchQuery(raw)));
}

/** Unify slashed and unslashed canonicals while preserving the root slash. */
function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * Retain the search term when applying title/episode filters; callers browsing without a query use `/search`
 * instead.
 */
export function buildMediaSearchPath(
  mediaPublicId: string,
  episode?: number | string | null,
  searchQuery?: string | null,
): string {
  const params = new URLSearchParams({ media: mediaPublicId });
  if (episode !== undefined && episode !== null && `${episode}` !== '') {
    params.set('episode', `${episode}`);
  }
  const base = searchQuery ? buildWordSearchPath(searchQuery) : '/search';
  return `${base}?${params.toString()}`;
}

/**
 * Canonical title-browse URL. Use `buildMediaSearchPath` instead when narrowing an existing query; browsing
 * and filtering are not interchangeable.
 */
export function buildMediaPath(slug: string, episode?: number | string | null): string {
  const base = `/media/${encodeURIComponent(slug)}`;
  if (episode === undefined || episode === null || `${episode}` === '') return base;
  return `${base}?episode=${encodeURIComponent(`${episode}`)}`;
}

/**
 * Prefer slug-based browse URLs, falling back to the legacy public-id filter when older payloads lack a slug.
 */
export function mediaBrowsePath(
  media: { publicId: string; slug?: string | null },
  episode?: number | string | null,
): string {
  return media.slug ? buildMediaPath(media.slug, episode) : buildMediaSearchPath(media.publicId, episode);
}

export function buildSentencePath(segmentPublicId: string): string {
  return `/sentence/${segmentPublicId}`;
}

/**
 * Scope keys include legacy `mediaId`/`episodeId` spellings that may still exist on client-side URLs before
 * server normalization.
 */
export const SEARCH_SCOPE_PARAMS = ['media', 'mediaId', 'episode', 'episodeId', 'category', 'sort'] as const;

/**
 * Carry the current search scope into a new query through an allowlist; display toggles and unrelated one-off
 * parameters must not follow it.
 */
export function searchScopeQuery<T>(query: Record<string, T> | undefined | null): Record<string, T> {
  if (!query) return {};
  const scope: Record<string, T> = {};
  for (const key of SEARCH_SCOPE_PARAMS) {
    const value = query[key];
    if (value !== undefined && value !== null && value !== '') {
      scope[key] = value;
    }
  }
  return scope;
}

/** Read the first route-query value, treating absent, null and empty values as no filter. */
export function getStringQueryValue(
  value: string | null | undefined | ReadonlyArray<string | null | undefined>,
): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined || first === null || first === '') {
    return null;
  }
  return String(first);
}

/** Shared filter syntax only; callers own category validation, defaults, and accepted keys. */
export function readSearchRouteFilters(query: Record<string, Parameters<typeof getStringQueryValue>[0]>) {
  const episode = getStringQueryValue(query.episode ?? query.episodeId);
  const seed = getStringQueryValue(query.seed);
  const parsedEpisode = episode === null ? Number.NaN : Number(episode);
  const parsedSeed = seed === null ? Number.NaN : Number(seed);
  return {
    category: getStringQueryValue(query.category),
    mediaPublicId: getStringQueryValue(query.media ?? query.mediaId),
    // Episodes keep decimals; only seeds are restricted to non-negative integers.
    episode: Number.isNaN(parsedEpisode) ? null : parsedEpisode,
    sort: getStringQueryValue(query.sort),
    randomSeed: Number.isInteger(parsedSeed) && parsedSeed >= 0 ? parsedSeed : null,
    segmentPublicId: getStringQueryValue(query.uuid),
  };
}
