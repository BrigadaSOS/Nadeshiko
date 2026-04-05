import { createNadeshikoClient, type NadeshikoClient } from '@brigadasos/nadeshiko-sdk';
import type {
  Segment,
  Media,
  SearchResponse,
  GetSegmentContextResponse,
  GetStatsOverviewResponse,
} from '@brigadasos/nadeshiko-sdk';
import { BOT_CONFIG } from './config';
import { createLogger } from './logger';

const log = createLogger('api');

export type { Segment, Media, SearchResponse };
export type ContextResponse = GetSegmentContextResponse;
export type StatsResponse = GetStatsOverviewResponse;
export type { MediaAutocompleteItem } from '@brigadasos/nadeshiko-sdk';

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
    mediaId?: string;
    episodes?: number[];
    lengthMin?: number;
    lengthMax?: number;
  } = {},
): Promise<SearchResponse> {
  const mediaInclude = options.mediaId
    ? {
        media: {
          include: [{ mediaId: options.mediaId, ...(options.episodes ? { episodes: options.episodes } : {}) }],
        },
      }
    : {};

  const lengthFilter =
    options.lengthMin || options.lengthMax
      ? { segmentLengthChars: { min: options.lengthMin, max: options.lengthMax } }
      : {};

  const filters = {
    status: ['ACTIVE', 'VERIFIED'] as ('ACTIVE' | 'VERIFIED')[],
    ...(options.category ? { category: [options.category as 'ANIME' | 'JDRAMA'] } : {}),
    ...mediaInclude,
    ...lengthFilter,
  };

  const body = {
    query: { search: query, exactMatch: options.exactMatch },
    take: options.take ?? BOT_CONFIG.maxSearchResults,
    cursor: options.cursor,
    include: ['media'] as 'media'[],
    filters,
    sort: options.sort ? { mode: options.sort as any, seed: options.seed } : undefined,
  };

  log.debug({ body }, 'Search request');

  const { data } = await sdk.search({ body });

  log.debug(
    { hits: data.segments.length, total: data.pagination.estimatedTotalHits, hasMore: data.pagination.hasMore },
    'Search response',
  );

  return data;
}

export async function getSegmentContext(uuid: string, take = 5): Promise<ContextResponse> {
  log.debug({ uuid, take }, 'Context request');
  const { data } = await sdk.getSegmentContext({
    path: { uuid },
    query: { take },
  });
  log.debug({ uuid, segments: data.segments.length }, 'Context response');
  return data;
}

export async function getSegmentByUuid(uuid: string): Promise<{ segment: Segment; media: Media | null }> {
  log.debug({ uuid }, 'Segment request');
  const { data } = await sdk.getSegmentByUuid({
    path: { uuid },
  });

  const segment = data as Segment;
  const media = (data as any).includes?.media?.[segment.mediaPublicId] ?? null;

  log.debug({ uuid, mediaPublicId: segment.mediaPublicId }, 'Segment response');
  return { segment, media };
}

export async function listMedia(take = 40, cursor?: string) {
  log.debug({ take, cursor }, 'List media request');
  const { data } = await sdk.listMedia({
    query: { take, cursor },
  });
  log.debug({ count: data.media.length, hasMore: data.pagination.hasMore }, 'List media response');
  return data;
}

export async function autocompleteMedia(query: string, take = 10) {
  log.debug({ query, take }, 'Media autocomplete request');
  const { data } = await sdk.autocompleteMedia({
    query: { query, take },
  });
  log.debug({ query, results: data.media.length }, 'Media autocomplete response');
  return data;
}

export async function getStats(): Promise<StatsResponse> {
  const { data } = await sdk.getStatsOverview();
  log.debug({ totalSegments: data.totalSegments, totalMedia: data.totalMedia }, 'Stats response');
  return data;
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
