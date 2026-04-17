import { createNadeshikoClient, type NadeshikoClient } from '@brigadasos/nadeshiko-sdk';
import type {
  Segment,
  Media,
  MediaSummary,
  SearchResponse as SdkSearchResponse,
  GetSegmentContextResponse as SdkGetSegmentContextResponse,
  GetStatsOverviewResponse,
  SearchStatsResponse as SdkSearchStatsResponse,
} from '@brigadasos/nadeshiko-sdk';
import { BOT_CONFIG } from './config';
import { createLogger } from './logger';

const log = createLogger('api');

export type { Segment, Media };
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

export async function search(
  query: string,
  options: {
    exactMatch?: boolean;
    take?: number;
    cursor?: string;
    sort?: string;
    seed?: number;
    category?: string;
    mediaPublicId?: string;
    episodes?: number[];
    lengthMin?: number;
    lengthMax?: number;
  } = {},
): Promise<SearchResponse> {
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

  const filters = {
    status: ['ACTIVE'] as 'ACTIVE'[],
    ...(options.category ? { category: [options.category as 'ANIME' | 'JDRAMA'] } : {}),
    ...mediaInclude,
    ...lengthFilter,
  };

  const body = {
    query: query ? { search: query, exactMatch: options.exactMatch } : undefined,
    take: options.take ?? BOT_CONFIG.maxSearchResults,
    cursor: options.cursor,
    include: ['media'] as 'media'[],
    filters,
    sort: options.sort ? { mode: options.sort as any, seed: options.seed } : undefined,
  };

  log.debug({ body }, 'Search request');

  const data = await sdk.search(body);
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
  const data = await sdk.getSegmentContext({
    segmentPublicId,
    take,
    include: ['media'],
  });
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
    sdk.getSegment(segmentPublicId),
    sdk.getSegmentContext({
      segmentPublicId,
      take: 1,
      include: ['media'],
    }),
  ]);

  const segment = segmentRes;
  const media = contextRes.includes?.media?.[segment.mediaPublicId] ?? null;

  log.debug({ segmentPublicId, mediaPublicId: segment.mediaPublicId }, 'Segment response');
  return { segment, media };
}

export async function listMedia(take = 40, cursor?: string) {
  log.debug({ take, cursor }, 'List media request');
  const data = await sdk.listMedia({ take, cursor });
  log.debug({ count: data.media.length, hasMore: data.pagination.hasMore }, 'List media response');
  return data;
}

export async function searchMedia(query: string, take = 10) {
  log.debug({ query, take }, 'Media autocomplete request');
  const data = await sdk.searchMedia({ query, take });
  log.debug({ query, results: data.media.length }, 'Media autocomplete response');
  return data;
}

export async function getStats(): Promise<StatsResponse> {
  const data = await sdk.getStatsOverview();
  log.debug({ totalSegments: data.totalSegments, totalMedia: data.totalMedia }, 'Stats response');
  return data;
}

export async function getSearchStats(
  query?: string,
  options?: { exactMatch?: boolean; category?: string },
): Promise<SearchStatsResponse> {
  log.debug({ query, ...options }, 'Search stats request');
  const data = await sdk.getSearchStats({
    query: query ? { search: query, exactMatch: options?.exactMatch } : undefined,
    filters: options?.category ? { category: [options.category as 'ANIME' | 'JDRAMA'] } : undefined,
    include: ['media'],
  });
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
