import { SUPPORTED_LOCALES } from '~/utils/i18n';

// Derived, never hand-listed: adding a locale to SUPPORTED_LOCALES has to be
// enough, or splitLocalePrefix silently stops recognising the new prefix and
// every caller (search-redirect, canonical, pagePath) treats it as a page path.
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
 * The `/search/:query` segment as text, from the raw param.
 *
 * The router hands this param through RAW -- ask for `/search/%2541` and the
 * param reads `%2541`, not `%41` -- so exactly one decode belongs here, and
 * `decodeURIComponent` is the wrong function to call unguarded: it throws a
 * `URIError` on any escape that is not valid UTF-8. `%E8%AD` (truncated),
 * `%C0%80` (overlong) and `%25E8%AD%B2` (mixed encoding depth) all qualify, and
 * an unhandled throw in page setup is a 500 -- prod answered
 * `{"statusCode":500,"message":"URI malformed"}` for every one of them.
 *
 * Falling back to the raw text is deliberate. It searches for something that
 * finds nothing, which is the honest answer for a query that was never text;
 * `normalizeSearchQuery` in the server middleware sends these to `/search`
 * before they reach a render, so this is the second line rather than the first.
 */
export function decodeSearchQuery(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Mirrors `maxLength: 500` on `SearchQuery.search` in the backend's OpenAPI
 * schema (`backend/docs/openapi/components/schemas/SearchQuery.yaml`). Past it
 * `/v1/search` answers 400 and always will, so a longer path can only ever
 * render an empty results page at the cost of a full SSR pass.
 */
export const SEARCH_QUERY_MAX_LENGTH = 500;

/**
 * A `/search/:query` segment that cannot have come from the search box.
 *
 * Three tests, each one a shape that only a machine produces:
 *
 * - **It does not decode.** A truncated or overlong escape (`%E8%AD`, `%C0%80`)
 *   is not text in any encoding, so there is nothing to search for.
 * - **It decodes to a path.** Queries are words and sentences; a `/` in one
 *   means a URL was fed to the search route as if it were a search term. That is
 *   exactly the shape the canonical loop minted --
 *   `/en/search/%2Fen%2Fsearch%2F...` wrapping 68 layers around 譲渡.
 * - **It is longer than the backend accepts.** See `SEARCH_QUERY_MAX_LENGTH`.
 *
 * The point of catching these at the HTTP layer rather than rendering them is
 * the crawler: a 301 to `/search` collapses a whole indexed family onto one URL
 * in a single hop, where a 200 -- even a correct, empty-results 200 -- keeps
 * every member of it alive and worth re-fetching.
 */
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
 * `route.path` with the `/search/:query` segment encoded exactly once.
 *
 * WHY THIS EXISTS -- `route.path` is one encoding layer deeper than the URL the
 * visitor asked for. vue-router hands params through raw and then percent-
 * encodes them again when it serialises the path, so a request for
 * `/en/search/%25E8` reads back as `/en/search/%2525E8`. Nothing notices until
 * that path is emitted as a link: the canonical and the hreflang alternates
 * then advertise a URL that is NOT the one the crawler fetched, and fetching
 * that one advertises another, one layer deeper again. Prod grew by 12 bytes a
 * hop with no ceiling -- the URL that surfaced this had 68 nested layers
 * wrapped around 譲渡, and every hop is a fresh SSR render of a page nobody
 * asked for.
 *
 * One decode plus one encode is a fixed point, which is the property that
 * matters: `%2525E8` decodes to `%25E8` and encodes back to `%2525E8`. A
 * generation already sitting in Google's index now canonicalises to ITSELF
 * instead of breeding a deeper sibling, so the family stops growing even while
 * the old members drain out.
 *
 * Only the search route needs this. Every other param in the app is a public id
 * or a slug, where encoding is the identity and the extra layer never shows.
 */
export function canonicalPath(path: string, queryParam: string | ReadonlyArray<string | null> | undefined): string {
  const raw = getStringQueryValue(queryParam);
  const { localePrefix, localizedPath } = splitLocalePrefix(path);
  if (raw === null || !localizedPath.startsWith('/search/')) {
    return path;
  }
  return withLocalePrefix(localePrefix, buildWordSearchPath(decodeSearchQuery(raw)));
}

export function buildMediaSearchPath(mediaPublicId: string, episode?: number | string | null): string {
  const params = new URLSearchParams({ media: mediaPublicId });
  if (episode !== undefined && episode !== null && `${episode}` !== '') {
    params.set('episode', `${episode}`);
  }
  return `/search?${params.toString()}`;
}

export function buildSentencePath(segmentPublicId: string): string {
  return `/sentence/${segmentPublicId}`;
}

/**
 * A single string from a route query value, or null when it is absent or empty.
 *
 * Vue Router types a query value as `string | string[] | null`, and both the
 * search page and the search container had their own copy of this narrowing --
 * one typed against `LocationQueryValue`, the other against plain strings.
 * An empty string is treated as absent: `?media=` means no filter, not a filter
 * matching the empty id. The parameter type mirrors Vue Router's `LocationQueryValue`
 * (`string | null`), so both callers pass their route query straight through.
 */
export function getStringQueryValue(
  value: string | null | undefined | ReadonlyArray<string | null | undefined>,
): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined || first === null || first === '') {
    return null;
  }
  return String(first);
}
