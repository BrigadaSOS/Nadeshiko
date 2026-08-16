import {
  getCollectionStats,
  getMedia,
  getSearchStats,
  getSegment,
  search,
  searchCollectionSegments,
  type Category,
  type ContentRating,
  type NadeshikoClient,
  type SearchFilters,
  type SearchSort,
} from '@brigadasos/nadeshiko-sdk';
// Relative rather than `~/`: this module is unit-tested outside Nuxt. `vitest.config.ts`
// now maps `~` too, so this is belt-and-braces rather than a hard requirement.
import { ALL_CATEGORIES, CATEGORY_API_MAPPING } from '../utils/categories';
import { reportError } from '../utils/reportError';
import { resolveSearchResponse, resolveStatsResponse } from '../utils/resolvers';
import type { MediaFilterItem, SearchResponse, SearchStatsResponse } from '~/types/search';

/** Page size for corpus searches (`/v1/search`). */
export const SEARCH_PAGE_SIZE = 30;
/** Page size for collection segment listings (`/v1/collections/:id/search`). */
export const COLLECTION_PAGE_SIZE = 20;

/** Everything the search endpoints need, flattened out of the route and the user's preferences. */
export type SearchScope = {
  /** Free-text query; empty means "browse everything the filters allow". */
  query: string;
  /** Category tab slug as it appears in the URL (`all`, `anime`, `liveaction`, `youtube`). */
  category: string;
  mediaPublicId: string | null;
  episode: number | null;
  /** Raw `?sort=` value; unset and `RELEVANCE` both mean "no explicit sort". */
  sort: string | null;
  /**
   * `?seed=`, which only `sort=random` carries. Sent as given so the shuffle is
   * reproducible: the same URL is the same order for whoever opens it, and
   * reshuffling means writing a new seed rather than asking again with the old one.
   */
  randomSeed: number | null;
  /** `?uuid=` permalink: resolves that one segment and ignores every other filter. */
  segmentPublicId: string | null;
  collectionId: string | null;
  listMediaIds: number[] | null;
  contentRating: ContentRating[];
  languages: SearchFilters['languages'];
  hiddenMediaExclude: MediaFilterItem[];
  /** Categories the reader hid wholesale; narrows the request to the rest. */
  hiddenCategories: Category[];
  /**
   * The reader's own titles, sent so the backend can break ties in their favour.
   *
   * Optional because most callers have no use for it: a collection listing and a
   * single-title browse are already narrowed to one set of titles, so preferring
   * some of them within a tie would reorder a page against a choice the reader
   * made explicitly.
   */
  preferMedia?: string[];
};

/**
 * `stale` means a newer request superseded this one — callers must drop the
 * result on the floor instead of writing it to shared state.
 */
export type FetchOutcome<T> =
  | { status: 'ok'; data: T }
  | { status: 'stale' }
  | { status: 'forbidden' }
  | { status: 'error' };

export type RequestGeneration = { id: number; signal: AbortSignal };

/**
 * Serializes a stream of requests that all write to the same state: starting a
 * new one aborts whatever was in flight and marks it stale forever after.
 */
export function createRequestSequencer() {
  let currentId = 0;
  let controller: AbortController | null = null;

  return {
    start(): RequestGeneration {
      controller?.abort();
      controller = new AbortController();
      currentId += 1;
      return { id: currentId, signal: controller.signal };
    },
    /** Aborts the in-flight request without opening a new generation. */
    cancel() {
      controller?.abort();
      controller = null;
      currentId += 1;
    },
    isCurrent(generation: RequestGeneration): boolean {
      return generation.id === currentId;
    },
  };
}

const buildSort = (raw: string | null, randomSeed: number | null): SearchSort | undefined => {
  const mode = raw ? raw.toUpperCase() : null;
  if (!mode || mode === 'RELEVANCE') {
    return undefined;
  }
  // Without a seed the backend falls back to one derived from the calendar day,
  // so every request that day comes back in the same order -- which is a fine
  // default for a shared `?sort=random` link, and useless for reshuffling.
  if (mode === 'RANDOM' && randomSeed !== null) {
    return { mode, seed: randomSeed };
  }
  return { mode: mode as NonNullable<SearchSort['mode']> };
};

/**
 * The schema's `maxItems` for `preferMedia`. Clamped here rather than trusted
 * from the caller: going over is a 400 on the search itself, which would trade a
 * cosmetic reordering for no results at all.
 */
const MAX_PREFERRED_MEDIA = 120;

/**
 * `preferMedia`, but only under the default order.
 *
 * Every other mode sorts on a key the reader named -- episode order, length, a
 * seeded shuffle -- and ties there are not ours to break. The backend enforces
 * the same rule; this half keeps a list of up to 120 identifiers off the wire on
 * requests that would discard it anyway.
 */
const preferMediaBody = (scope: SearchScope, sort: SearchSort | undefined): { preferMedia?: string[] } => {
  if (sort !== undefined) return {};
  if (!scope.preferMedia?.length) return {};

  return { preferMedia: scope.preferMedia.slice(0, MAX_PREFERRED_MEDIA) };
};

const mediaInclude = (scope: SearchScope, withSelectedMedia: boolean): MediaFilterItem[] => {
  const include: MediaFilterItem[] = [];

  if (withSelectedMedia && scope.mediaPublicId) {
    include.push(
      scope.episode !== null
        ? { mediaPublicId: scope.mediaPublicId, episodes: [scope.episode] }
        : { mediaPublicId: scope.mediaPublicId },
    );
  }
  for (const id of scope.listMediaIds ?? []) {
    include.push({ mediaPublicId: String(id) });
  }

  return include;
};

const buildFilters = (
  scope: SearchScope,
  options: { withSelectedMedia: boolean; excludeHiddenMedia: boolean },
): SearchFilters => {
  const filters: SearchFilters = {};

  const category = CATEGORY_API_MAPPING[scope.category];
  if (category) {
    // A category picked in the URL wins over the hidden list, the same way an
    // explicit `?media=` beats hidden media: asking for a hidden category shows it.
    filters.category = [category];
  } else {
    const visible = ALL_CATEGORIES.filter((item) => !scope.hiddenCategories.includes(item));
    // An empty list would read as "no filter" server-side and hand back the whole
    // corpus, so the all-hidden state is refused where it is set, not patched here.
    if (visible.length > 0 && visible.length < ALL_CATEGORIES.length) {
      filters.category = visible;
    }
  }

  const include = mediaInclude(scope, options.withSelectedMedia);
  if (include.length > 0) {
    filters.media = { include };
  }

  filters.contentRating = scope.contentRating;

  if (options.excludeHiddenMedia && scope.hiddenMediaExclude.length > 0) {
    filters.media = {
      ...(filters.media ?? {}),
      exclude: [...(filters.media?.exclude ?? []), ...scope.hiddenMediaExclude],
    };
  }

  if (scope.languages) {
    filters.languages = scope.languages;
  }

  return filters;
};

/**
 * Filters for the result list. An explicit `?media=` beats the user's
 * hidden-media list: asking for a hidden show by id shows it.
 */
export const buildSentenceFilters = (scope: SearchScope): SearchFilters =>
  buildFilters(scope, { withSelectedMedia: true, excludeHiddenMedia: !scope.mediaPublicId });

/**
 * Filters for the category and media tab counts. `?media=` is deliberately not
 * applied so the tabs keep describing the whole result set the query matches;
 * hidden media stay out of the counts in every case.
 */
export const buildStatsFilters = (scope: SearchScope): SearchFilters =>
  buildFilters(scope, { withSelectedMedia: false, excludeHiddenMedia: true });

const isForbidden = (response: Response | undefined): boolean => response?.status === 401 || response?.status === 403;

/**
 * The request never got an answer at all: the connection dropped, the tab was
 * navigating away, an extension blocked it, the edge is down.
 *
 * It surfaces here rather than in the `catch` below because the SDK client
 * resolves transport failures instead of throwing, so `response` is absent (or,
 * for an opaque one, status 0) and there is no status to report.
 */
const isTransportFailure = (response: Response | undefined): boolean => response === undefined || response.status === 0;

/**
 * A response that came back without a body. 401/403 is the server telling the
 * caller "not yours" -- expected, and reporting it only buys noise: Cloudflare
 * challenges and expired sessions both land here, from clients we cannot fix.
 *
 * Everything else is reported HERE rather than by the caller, because this is
 * the last place holding the status code. The page used to synthesize its own
 * `new Error("... returned \"error\"")` from the bare outcome instead, which
 * fingerprinted separately, carried no stack, and double-counted every failure
 * the catch below had already reported with a real one.
 */
const emptyResponseOutcome = (
  scope: 'collection' | 'corpus' | 'segment',
  kind: 'sentences' | 'stats',
  response: Response | undefined,
): { status: 'forbidden' } | { status: 'error' } => {
  if (isForbidden(response)) {
    return { status: 'forbidden' };
  }

  // 429 is the server asking for less. Answered by backing off, not by a fix
  // here, and the server already counts its own throttling -- so this one is
  // dropped outright rather than reported anywhere.
  if (response?.status === 429) {
    return { status: 'error' };
  }

  // A transport failure goes to Faro but NOT to PostHog error tracking. Two
  // thirds of both search fingerprints were this, landing on the sentences and
  // the stats fetch in the *same millisecond* -- one reader's network going
  // away, filed as two faults of ours. As triaged issues they are unactionable
  // noise, which is what buried the reports that are not.
  //
  // They are still worth counting, though, and dropping them entirely was the
  // wrong trade: if the edge fails while the origin is healthy, server-side
  // metrics look fine and this is the only place the outage is visible. Faro
  // takes it as one more exception in a stream nobody triages, where a spike
  // reads as a spike; PostHog keeps its issue list about things with a fix.
  const transportFailure = isTransportFailure(response);

  // The status code stays OUT of the message and in the properties: it is the one
  // part that varies, and interpolating it would fingerprint 500 apart from 503
  // and scatter one fault across an issue per status code.
  reportError(
    `search:${kind}-fetch-failed`,
    new Error(`search ${kind} fetch returned an empty response`),
    {
      'search.scope': scope,
      'http.status_code': String(response?.status ?? 0),
    },
    { faroOnly: transportFailure },
  );
  return { status: 'error' };
};

/**
 * The two search fetches (result list and tab statistics) shared by the search
 * page's SSR priming and the client-side container, each guarded by its own
 * sequencer so a route change can cancel the request it replaces.
 */
export function createSearchFetcher(sdk: NadeshikoClient) {
  const sentenceRequests = createRequestSequencer();
  const statsRequests = createRequestSequencer();

  const requestOptions = (generation: RequestGeneration) =>
    ({ client: sdk.client, signal: generation.signal, throwOnError: false }) as const;

  const fetchSentences = async (
    scope: SearchScope,
    options: { cursor?: string | null } = {},
  ): Promise<FetchOutcome<SearchResponse>> => {
    const generation = sentenceRequests.start();
    const stale = (): boolean => !sentenceRequests.isCurrent(generation);

    try {
      if (scope.segmentPublicId) {
        const segmentResult = await getSegment({
          ...requestOptions(generation),
          path: { segmentPublicId: scope.segmentPublicId },
        });
        if (stale()) return { status: 'stale' };
        const segment = segmentResult.data;
        if (!segment) {
          return emptyResponseOutcome('segment', 'sentences', segmentResult.response);
        }

        const mediaResult = await getMedia({
          ...requestOptions(generation),
          path: { mediaPublicId: segment.mediaPublicId },
        });
        if (stale()) return { status: 'stale' };
        const media = mediaResult.data;

        return {
          status: 'ok',
          data: resolveSearchResponse({
            segments: [segment],
            includes: { media: media ? { [segment.mediaPublicId]: media } : {} },
            pagination: { hasMore: false, cursor: '', estimatedTotalHits: 1, estimatedTotalHitsRelation: 'EXACT' },
          }),
        };
      }

      if (scope.collectionId) {
        const result = await searchCollectionSegments({
          ...requestOptions(generation),
          path: { collectionPublicId: scope.collectionId },
          body: {
            take: COLLECTION_PAGE_SIZE,
            include: ['media'],
            ...(options.cursor ? { cursor: options.cursor } : {}),
          },
        });
        if (stale()) return { status: 'stale' };
        if (!result.data) {
          return emptyResponseOutcome('collection', 'sentences', result.response);
        }
        return { status: 'ok', data: resolveSearchResponse(result.data) };
      }

      const sort = buildSort(scope.sort, scope.randomSeed);
      const result = await search({
        ...requestOptions(generation),
        body: {
          query: scope.query ? { search: scope.query } : undefined,
          take: SEARCH_PAGE_SIZE,
          sort,
          cursor: options.cursor ?? undefined,
          filters: buildSentenceFilters(scope),
          include: ['media'],
          ...preferMediaBody(scope, sort),
        },
      });
      if (stale()) return { status: 'stale' };
      if (!result.data) {
        return emptyResponseOutcome('corpus', 'sentences', result.response);
      }
      return { status: 'ok', data: resolveSearchResponse(result.data) };
    } catch (error) {
      // A superseded request rejects because we aborted it, which is not a failure.
      if (stale()) return { status: 'stale' };
      reportError('search:sentences-fetch-failed', error, {
        'search.scope': scope.collectionId ? 'collection' : 'corpus',
      });
      return { status: 'error' };
    }
  };

  const fetchStats = async (scope: SearchScope): Promise<FetchOutcome<SearchStatsResponse>> => {
    const generation = statsRequests.start();
    const stale = (): boolean => !statsRequests.isCurrent(generation);

    try {
      if (scope.collectionId) {
        const result = await getCollectionStats({
          ...requestOptions(generation),
          path: { collectionPublicId: scope.collectionId },
        });
        if (stale()) return { status: 'stale' };
        if (!result.data) {
          return emptyResponseOutcome('collection', 'stats', result.response);
        }
        return { status: 'ok', data: resolveStatsResponse(result.data) };
      }

      const result = await getSearchStats({
        ...requestOptions(generation),
        body: {
          query: scope.query ? { search: scope.query } : undefined,
          filters: buildStatsFilters(scope),
          include: ['media'],
        },
      });
      if (stale()) return { status: 'stale' };
      if (!result.data) {
        return emptyResponseOutcome('corpus', 'stats', result.response);
      }
      return { status: 'ok', data: resolveStatsResponse(result.data) };
    } catch (error) {
      // A superseded request rejects because we aborted it, which is not a failure.
      if (stale()) return { status: 'stale' };
      reportError('search:stats-fetch-failed', error, { 'search.scope': scope.collectionId ? 'collection' : 'corpus' });
      return { status: 'error' };
    }
  };

  return {
    fetchSentences,
    fetchStats,
    cancelSentences: sentenceRequests.cancel,
    cancelStats: statsRequests.cancel,
  };
}

export type SearchFetcher = ReturnType<typeof createSearchFetcher>;

export function useSearchFetch(): SearchFetcher {
  return createSearchFetcher(useNadeshikoSdk());
}
