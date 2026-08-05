import { createNadeshikoClient, NadeshikoError, type NadeshikoClient } from '@brigadasos/nadeshiko-sdk';
import type {
  Segment,
  Media,
  MediaSummary,
  Category,
  SearchFilters,
  SearchResponse as SdkSearchResponse,
  GetSegmentContextResponse as SdkGetSegmentContextResponse,
  GetStatsOverviewResponse,
  GetSearchStatsResponse as SdkSearchStatsResponse,
} from '@brigadasos/nadeshiko-sdk';
import { BOT_CONFIG } from './config';
import { createLogger } from './logger';

const log = createLogger('api');

export type { Segment, Media, Category };

/**
 * The SDK does not re-export `SearchRequest`/`SearchSort` from its root, so we
 * read them off the client signature instead of restating them here -- that way
 * they still track the spec.
 */
type SearchRequest = NonNullable<Parameters<NadeshikoClient['search']>[0]>;
/** Sort modes the API accepts, e.g. `'RELEVANCE' | 'ASC' | ... | 'RANDOM'`. */
export type SortMode = NonNullable<NonNullable<SearchRequest['sort']>['mode']>;

/**
 * Keyed by the SDK unions so that adding, renaming, or dropping a value in the
 * API spec fails the build here instead of at runtime.
 */
const SORT_MODES: Record<SortMode, true> = {
  RELEVANCE: true,
  ASC: true,
  DESC: true,
  TIME_ASC: true,
  TIME_DESC: true,
  RANDOM: true,
};

// YOUTUBE is accepted by the API but is deliberately not offered as a slash-command
// choice yet -- surfacing it to users is a product decision, not a typing one.
const CATEGORIES: Record<Category, true> = {
  ANIME: true,
  JDRAMA: true,
  YOUTUBE: true,
};

/** Narrows free-form user input to a sort mode; returns undefined when it isn't one. */
export function parseSortMode(input: string | null | undefined): SortMode | undefined {
  const candidate = input?.trim().toUpperCase();
  return candidate && candidate in SORT_MODES ? (candidate as SortMode) : undefined;
}

/** Narrows a command option to a category; returns undefined when it isn't one. */
export function parseCategory(input: string | null | undefined): Category | undefined {
  const candidate = input?.trim().toUpperCase();
  return candidate && candidate in CATEGORIES ? (candidate as Category) : undefined;
}
export type SearchResponse = Omit<SdkSearchResponse, 'includes'> & { includes: { media: Record<string, Media> } };
export type SearchStatsResponse = Omit<SdkSearchStatsResponse, 'includes'> & {
  includes: { media: Record<string, Media> };
};
export type ContextResponse = Omit<SdkGetSegmentContextResponse, 'includes'> & {
  includes: { media: Record<string, Media> };
};
export type StatsResponse = GetStatsOverviewResponse;
export type MediaAutocompleteItem = MediaSummary;

let sdk: NadeshikoClient;

export function initSdk() {
  sdk = createNadeshikoClient({
    apiKey: BOT_CONFIG.apiKey,
    baseURL: BOT_CONFIG.apiBaseUrl,
  });

  sdk.client.interceptors.request.use((request) => {
    log.debug({ method: request.method, url: request.url }, 'API request');
    return request;
  });

  sdk.client.interceptors.response.use((response) => {
    if (!response.ok) {
      log.warn({ url: response.url, status: response.status }, 'API request failed');
    } else {
      log.debug({ url: response.url, status: response.status }, 'API response');
    }
    return response;
  });
}

/**
 * Logs the structured detail the SDK attaches to API failures (error code and
 * trace ID, which is what support needs) before rethrowing. Callers keep
 * handling errors exactly as before.
 */
async function callApi<T>(operation: string, request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof NadeshikoError) {
      log.error(
        {
          operation,
          code: error.code,
          status: error.status,
          traceId: error.traceId,
          detail: error.detail,
          errors: error.errors,
        },
        'API returned an error',
      );
    } else {
      log.error({ operation, err: error }, 'API request threw');
    }
    throw error;
  }
}

export type SearchOptions = {
  exactMatch?: boolean;
  take?: number;
  cursor?: string;
  sort?: SortMode;
  seed?: number;
  category?: Category;
  mediaPublicId?: string;
  episodes?: number[];
  lengthMin?: number;
  lengthMax?: number;
};

export async function search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
  const mediaInclude = options.mediaPublicId
    ? {
        media: {
          include: [
            {
              mediaPublicId: options.mediaPublicId,
              ...(options.episodes ? { episodes: options.episodes } : {}),
            },
          ],
        },
      }
    : {};

  const lengthFilter =
    options.lengthMin || options.lengthMax
      ? { segmentLengthChars: { min: options.lengthMin, max: options.lengthMax } }
      : {};

  const filters: SearchFilters = {
    status: ['ACTIVE'],
    ...(options.category ? { category: [options.category] } : {}),
    ...mediaInclude,
    ...lengthFilter,
  };

  const body: SearchRequest = {
    query: query ? { search: query, exactMatch: options.exactMatch } : undefined,
    take: options.take ?? BOT_CONFIG.maxSearchResults,
    cursor: options.cursor,
    include: ['media'],
    filters,
    sort: options.sort ? { mode: options.sort, seed: options.seed } : undefined,
  };

  log.debug({ body }, 'Search request');

  const data = await callApi('search', () => sdk.search(body));
  const response: SearchResponse = {
    ...data,
    includes: {
      media: data.includes?.media ?? {},
    },
  };

  log.debug(
    {
      hits: response.segments.length,
      total: response.pagination.estimatedTotalHits,
      hasMore: response.pagination.hasMore,
    },
    'Search response',
  );

  return response;
}

export function fetchRandom(mediaPublicId?: string, episodes?: number[]) {
  return search('', {
    take: 1,
    sort: 'RANDOM',
    seed: Math.floor(Math.random() * 1_000_000),
    mediaPublicId,
    episodes,
  });
}

export async function getSegmentContext(segmentPublicId: string, take = 5): Promise<ContextResponse> {
  log.debug({ segmentPublicId, take }, 'Context request');
  const data = await callApi('getSegmentContext', () =>
    sdk.getSegmentContext({
      segmentPublicId,
      take,
      include: ['media'],
    }),
  );
  const response: ContextResponse = {
    ...data,
    includes: {
      media: data.includes?.media ?? {},
    },
  };
  log.debug({ segmentPublicId, segments: response.segments.length }, 'Context response');
  return response;
}

export async function getSegment(segmentPublicId: string): Promise<{ segment: Segment; media: Media | null }> {
  log.debug({ segmentPublicId }, 'Segment request');
  const [segmentRes, contextRes] = await Promise.all([
    callApi('getSegment', () => sdk.getSegment(segmentPublicId)),
    callApi('getSegmentContext', () =>
      sdk.getSegmentContext({
        segmentPublicId,
        take: 1,
        include: ['media'],
      }),
    ),
  ]);

  const segment = segmentRes;
  const media = contextRes.includes?.media?.[segment.mediaPublicId] ?? null;

  log.debug({ segmentPublicId, mediaPublicId: segment.mediaPublicId }, 'Segment response');
  return { segment, media };
}

export async function listMedia(take = 40, cursor?: string) {
  log.debug({ take, cursor }, 'List media request');
  const data = await callApi('listMedia', () => sdk.listMedia({ take, cursor }));
  log.debug({ count: data.media.length, hasMore: data.pagination.hasMore }, 'List media response');
  return data;
}

export async function searchMedia(query: string, take = 10) {
  log.debug({ query, take }, 'Media autocomplete request');
  const data = await callApi('searchMedia', () => sdk.searchMedia({ query, take }));
  log.debug({ query, results: data.media.length }, 'Media autocomplete response');
  return data;
}

export async function getStats(): Promise<StatsResponse> {
  const data = await callApi('getStatsOverview', () => sdk.getStatsOverview());
  log.debug({ totalSegments: data.totalSegments, totalMedia: data.totalMedia }, 'Stats response');
  return data;
}

export async function getSearchStats(
  query?: string,
  options?: { exactMatch?: boolean; category?: Category },
): Promise<SearchStatsResponse> {
  log.debug({ query, ...options }, 'Search stats request');
  const data = await callApi('getSearchStats', () =>
    sdk.getSearchStats({
      query: query ? { search: query, exactMatch: options?.exactMatch } : undefined,
      filters: options?.category ? { category: [options.category] } : undefined,
      include: ['media'],
    }),
  );
  const response: SearchStatsResponse = {
    ...data,
    includes: {
      media: data.includes?.media ?? {},
    },
  };
  log.debug({ mediaCount: response.media.length, categories: response.categories.length }, 'Search stats response');
  return response;
}

export async function downloadFile(url: string): Promise<Buffer | null> {
  log.debug({ url }, 'File download request');
  const response = await fetch(url);
  if (!response.ok) {
    log.warn({ url, status: response.status }, 'File download failed');
    return null;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  log.debug({ url, bytes: buffer.length }, 'File download complete');
  return buffer;
}
