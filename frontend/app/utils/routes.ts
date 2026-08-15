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
 * Where a remembered search re-runs: the query, plus the title it was run inside
 * when it had one -- 食べる everywhere and 食べる in Bocchi are two different
 * searches and come back as two different rows.
 *
 * Rebuilt rather than copied from the URL it was recorded on, which is why no
 * episode, sort or cursor rides along: the title is what the reader searched
 * inside, while the third page of one of its episodes is where they happened to
 * be standing when they got there.
 */
export function buildScopedSearchPath(word: string, mediaPublicId?: string | null): string {
  const path = buildWordSearchPath(word);
  return mediaPublicId ? `${path}?media=${encodeURIComponent(mediaPublicId)}` : path;
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
/**
 * Everything after the path in a full path -- the query string, the hash, or both.
 *
 * Taken verbatim rather than rebuilt from `route.query`, because rebuilding means
 * re-encoding, and re-encoding is the whole family of bugs this file exists to
 * keep out of hrefs. Nothing here needs to understand the query, only to carry it
 * across unchanged.
 */
export function queryAndHash(fullPath: string): string {
  const cut = fullPath.search(/[?#]/);
  return cut === -1 ? '' : fullPath.slice(cut);
}

/**
 * A bound on how many times `overEscapedSearchQuery` will unwrap.
 *
 * Only a ceiling on pathological input, not a judgement about how deep a real
 * family goes: the one that surfaced this bug had 68 layers, and each hop is a
 * fixed cost here rather than the SSR render it used to be.
 */
const MAX_SEARCH_DECODE_ROUNDS = 80;

/**
 * The text a multiply-escaped `/search/:query` segment was originally about, or
 * `null` when the segment is encoded the ordinary once.
 *
 * WHY, given `canonicalPath` already exists. That function made the canonical a
 * fixed point, which stopped the family GROWING through the canonical link --
 * `%2525E8` now advertises itself rather than a deeper sibling. What it cannot
 * do is make the family SHRINK: every generation already in an index stays alive,
 * answering 200, each one a real SSR render. And growth did not actually stop,
 * because the canonical is not the only link on the page -- the i18n module
 * builds its hreflang and locale-switcher hrefs from the router's `route.path`,
 * one layer deeper again. Fetching `/en/search/%25E6%2595%25B0%25E5%258D%2581`
 * on production returns 200 and three `%2525…` links, one per locale.
 *
 * A 301 to the ordinary encoding does what a fixed point cannot: it collapses the
 * whole family onto one URL in a single hop, and it does so before the render, so
 * the deeper links are never emitted at all.
 *
 * Counting rounds is what separates over-escaped from ordinary. `数十` needs one
 * decode; `%25E6%2595%25B0…` needs two. A second round that still yields
 * something new is the signal, and it is a narrow one:
 *
 * - `100%25` decodes to `100%`, and decoding `100%` throws -- one round, ordinary.
 * - `%25E6` decodes to `%E6`, an incomplete UTF-8 sequence that throws -- one
 *   round, ordinary.
 * - `%2541` decodes to `%41` decodes to `A` -- two rounds, so a reader searching
 *   for the literal text `%41` is redirected to a search for `A`. That is the
 *   one false positive this trades for, and against a corpus of Japanese
 *   subtitles it is a fair trade.
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

/**
 * The media -- and optionally episode -- filter as a path.
 *
 * `searchQuery` is what keeps a filter click from throwing the search away. From
 * `/search/食べる`, narrowing to a title has to land on `/search/食べる?media=…`;
 * without the segment it lands on `/search?media=…`, which silently turns the
 * reader's search into a browse of everything that title has. Callers with no
 * search behind them -- the home grid, the media index -- omit it and get the
 * browse path, which is the right destination there.
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
 * A title's own page, addressed the way a reader and a crawler can both read it.
 *
 * This is the canonical home of a media browse -- `/media/steins-gate` rather
 * than `/search?media=V1StGXR8_Z5d`, which is what the 317 media URLs in the
 * sitemap used to be. An opaque twelve-character id in a filter parameter tells a
 * search engine nothing about the page and cannot be typed, guessed or read
 * aloud; the slug is the same information in the part of the URL that ranks.
 *
 * `buildMediaSearchPath` above is still the right call when a SEARCH is being
 * narrowed to a title, because that URL has to keep carrying the search term.
 * The two are not interchangeable: this one browses a title, that one filters a
 * query.
 */
export function buildMediaPath(slug: string, episode?: number | string | null): string {
  const base = `/media/${encodeURIComponent(slug)}`;
  if (episode === undefined || episode === null || `${episode}` === '') return base;
  return `${base}?episode=${encodeURIComponent(`${episode}`)}`;
}

/**
 * The link to a title from anywhere that is BROWSING rather than searching --
 * the home grid, the catalogue, a breadcrumb.
 *
 * Always prefer this over calling either builder directly at a link site: it
 * picks the readable URL when the payload carries a slug and falls back to the
 * old filter URL when it does not, so a link never dead-ends on a title that
 * predates slugs. Both destinations render the same page; only one is canonical,
 * and the other 301s to it -- which is exactly the hop worth avoiding on an
 * internal link.
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
 * The query keys that say WHERE a reader is searching, as opposed to what they
 * searched for or how the page is drawn.
 *
 * `mediaId`/`episodeId` are the legacy spellings. The server middleware rewrites
 * them to `media`/`episode` on a full page load, but a client-side URL can still
 * be holding one, and a scope that survives a click only when the reader arrived
 * by SSR is worse than one that never survives at all.
 */
export const SEARCH_SCOPE_PARAMS = ['media', 'mediaId', 'episode', 'episodeId', 'category', 'sort'] as const;

/**
 * The scope of the current search, ready to hand to the next one.
 *
 * Searching a new word from inside a title is still a search inside that title:
 * the reader picked the show, and picking a word out of a sentence is not
 * un-picking it. The search box has always worked this way -- typing a word
 * keeps the filters -- so a word CLICKED out of a sentence that dropped them
 * meant the same action did two different things depending on how it was
 * started.
 *
 * An allowlist rather than "everything except the display toggles": what belongs
 * in a scope is a short, known list, and a `?uuid=` or a future one-off param
 * riding along by default is how a filter ends up somewhere nobody meant it to
 * be.
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
