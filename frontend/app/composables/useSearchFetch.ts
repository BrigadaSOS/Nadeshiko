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

import { ALL_CATEGORIES, CATEGORY_API_MAPPING } from '../utils/categories';
import { reportError, reportEvent } from '../utils/reportError';
import { classifySearchFailure, type SearchFailure, type SearchFetchScope } from '../utils/searchFailure';
import { resolveSearchResponse, resolveStatsResponse } from '../utils/resolvers';
import type { MediaFilterItem, SearchResponse, SearchStatsResponse } from '~/types/search';
import type { InjectionKey, Ref } from 'vue';

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
  /** Preserve the random seed for reproducible shared URLs; reshuffling requires a new seed. */
  randomSeed: number | null;
  /** `?uuid=` permalink: resolves that one segment and ignores every other filter. */
  segmentPublicId: string | null;
  collectionId: string | null;
  contentRating: ContentRating[];
  languages: SearchFilters['languages'];
  hiddenMediaExclude: MediaFilterItem[];
  /** Categories the reader hid wholesale; narrows the request to the rest. */
  hiddenCategories: Category[];
  /**
   * Prefer familiar titles only where the scope permits tie-breaking; explicit title and
   * collection choices must not be reordered by it.
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
  | { status: 'error'; failure: SearchFailure };

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
 * Clamp to the API's preferMedia maxItems: optional tie-breaking must not make the search
 * return 400.
 */
const MAX_PREFERRED_MEDIA = 120;

/** Send preferMedia only for default ordering; explicit sorts discard it server-side. */
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

/**
 * Drawer counts span the selected title, not the selected episode. Drop episode and
 * hidden-media exclusions so siblings remain reachable even for an explicitly requested hidden
 * title.
 */
export const buildMediaStatsFilters = (scope: SearchScope): SearchFilters =>
  buildFilters({ ...scope, episode: null }, { withSelectedMedia: true, excludeHiddenMedia: false });

/**
 * Shrink SSR payloads by emptying episodeHits except for the selected title. Keep the required
 * key: the drawer treats [] as 'fetch this title's breakdown'. Client refetches retain full
 * counts.
 */
export const stripEpisodeHits = (
  stats: SearchStatsResponse,
  keepMediaPublicId: string | null,
): SearchStatsResponse => ({
  ...stats,
  media: stats.media.map((entry) =>
    entry.mediaPublicId === keepMediaPublicId ? entry : { ...entry, episodeHits: [] },
  ),
});

/**
 * Remove only unread posLabel from SSR tokens. Preserve b/e for highlighting, furigana, and
 * expansion offsets, plus kind and the remaining rendering/lookup fields.
 */
export const stripUnreadTokenFields = (response: SearchResponse): SearchResponse => ({
  ...response,
  results: response.results.map((result) => {
    const tokens = result.segment.textJa?.tokens;
    if (!tokens?.length) return result;

    return {
      ...result,
      segment: {
        ...result.segment,
        textJa: {
          ...result.segment.textJa,
          tokens: tokens.map(({ posLabel: _posLabel, ...rest }) => rest),
        },
      },
    };
  }),
});

/**
 * SearchContainer provides drawer loading state directly to FilterContent, bypassing unrelated
 * SegmentSidebar. Standalone panels default to not loading.
 */
export const EPISODE_HITS_LOADING: InjectionKey<Readonly<Ref<boolean>>> = Symbol('nd-episode-hits-loading');

const isForbidden = (response: Response | undefined): boolean => response?.status === 401 || response?.status === 403;

/**
 * The SDK resolves transport failures instead of throwing; response is absent or has opaque
 * status 0.
 */
const isTransportFailure = (response: Response | undefined): boolean => response === undefined || response.status === 0;

/**
 * Treat only Cloudflare 520–526 failures as edge outages. Other 5xx responses may be
 * application faults and must remain actionable.
 */
const isCloudflareEdgeFailure = (response: Response | undefined): boolean =>
  response !== undefined && response.status >= 520 && response.status <= 526;

/**
 * Normalize a failed request once, before either the client UI or SSR stores it.
 * Error bodies are deliberately not consumed: only status and a known quota
 * header can select frontend-owned, translated messages.
 */
const failedResponseOutcome = (
  scope: SearchFetchScope,
  kind: 'sentences' | 'stats',
  response: Response | undefined,
): { status: 'forbidden' } | { status: 'error'; failure: SearchFailure } => {
  if (isForbidden(response)) return { status: 'forbidden' };

  const failure = classifySearchFailure(response?.status, scope, response?.headers.get('X-RateLimit-Reason'));
  const outcome = { status: 'error', failure } as const;

  // Expected client errors are already counted by the backend, not application faults.
  if (failure.kind !== 'unavailable') return outcome;

  if (isTransportFailure(response) || isCloudflareEdgeFailure(response)) {
    reportEvent('search_fetch_failed', {
      'search.kind': kind,
      'search.scope': scope,
      'http.status_code': String(response?.status ?? 0),
    });
    return outcome;
  }

  reportError(`search:${kind}-fetch-failed`, new Error(`search ${kind} request failed`), {
    'search.scope': scope,
    'http.status_code': String(response?.status ?? 0),
  });
  return outcome;
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
          return failedResponseOutcome('segment', 'sentences', segmentResult.response);
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
          return failedResponseOutcome('collection', 'sentences', result.response);
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
        return failedResponseOutcome('corpus', 'sentences', result.response);
      }
      return { status: 'ok', data: resolveSearchResponse(result.data) };
    } catch {
      // A superseded request rejects because we aborted it, which is not a failure.
      if (stale()) return { status: 'stale' };
      reportError('search:sentences-fetch-failed', new Error('search sentences response could not be resolved'), {
        'search.scope': scope.segmentPublicId ? 'segment' : scope.collectionId ? 'collection' : 'corpus',
      });
      return { status: 'error', failure: { kind: 'unavailable' } };
    }
  };

  /**
   * `scopeToSelectedMedia` asks for one title's counts instead of the whole
   * result set's: the drill-down request, not the tab request. See
   * `buildMediaStatsFilters`.
   */
  const fetchStats = async (
    scope: SearchScope,
    options: { scopeToSelectedMedia?: boolean } = {},
  ): Promise<FetchOutcome<SearchStatsResponse>> => {
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
          return failedResponseOutcome('collection', 'stats', result.response);
        }
        return { status: 'ok', data: resolveStatsResponse(result.data) };
      }

      const result = await getSearchStats({
        ...requestOptions(generation),
        body: {
          query: scope.query ? { search: scope.query } : undefined,
          filters: options.scopeToSelectedMedia ? buildMediaStatsFilters(scope) : buildStatsFilters(scope),
          // No `include` on the drill-down: the only field read off that answer
          // is `episodeHits`, and the title's name, slug and format are already
          // on the row the reader clicked to get here.
          ...(options.scopeToSelectedMedia ? {} : { include: ['media' as const] }),
        },
      });
      if (stale()) return { status: 'stale' };
      if (!result.data) {
        return failedResponseOutcome('corpus', 'stats', result.response);
      }
      return { status: 'ok', data: resolveStatsResponse(result.data) };
    } catch {
      // A superseded request rejects because we aborted it, which is not a failure.
      if (stale()) return { status: 'stale' };
      reportError('search:stats-fetch-failed', new Error('search stats response could not be resolved'), {
        'search.scope': scope.collectionId ? 'collection' : 'corpus',
      });
      return { status: 'error', failure: { kind: 'unavailable' } };
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
