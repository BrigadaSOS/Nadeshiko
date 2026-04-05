import { createNadeshikoClient, type NadeshikoClient } from '@brigadasos/nadeshiko-sdk';
import type {
  Segment,
  Media,
  SearchResponse,
  GetSegmentContextResponse,
  GetStatsOverviewResponse,
} from '@brigadasos/nadeshiko-sdk';
import { BOT_CONFIG } from './config';
import { traceApiCall } from './instrumentation';
import { createLogger } from './logger';

const log = createLogger('api');

export type { Segment, Media, SearchResponse };
export type ContextResponse = GetSegmentContextResponse;
export type StatsResponse = GetStatsOverviewResponse;

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
  } = {},
): Promise<SearchResponse> {
  return traceApiCall('POST', '/v1/search', async () => {
    const filters = {
      status: ['ACTIVE', 'VERIFIED'] as ('ACTIVE' | 'VERIFIED')[],
      ...(options.category ? { category: [options.category as 'ANIME' | 'JDRAMA'] } : {}),
    };

    const { data } = await sdk.search({
      body: {
        query: { search: query, exactMatch: options.exactMatch },
        take: options.take ?? BOT_CONFIG.maxSearchResults,
        cursor: options.cursor,
        include: ['media'],
        filters,
        sort: options.sort ? { mode: options.sort as any, seed: options.seed } : undefined,
      },
    });

    return data;
  });
}

export async function getSegmentContext(uuid: string, take = 5): Promise<ContextResponse> {
  return traceApiCall('GET', `/v1/media/segments/${uuid}/context`, async () => {
    const { data } = await sdk.getSegmentContext({
      path: { uuid },
      query: { take },
    });
    return data;
  });
}

export async function getSegmentByUuid(uuid: string): Promise<{ segment: Segment; media: Media | null }> {
  return traceApiCall('GET', `/v1/media/segments/${uuid}`, async () => {
    const { data } = await sdk.getSegmentByUuid({
      path: { uuid },
    });

    const segment = data as Segment;
    const media = (data as any).includes?.media?.[segment.mediaPublicId] ?? null;

    return { segment, media };
  });
}

export async function getStats(): Promise<StatsResponse> {
  return traceApiCall('GET', '/v1/stats/overview', async () => {
    const { data } = await sdk.getStatsOverview();
    return data;
  });
}

export async function downloadFile(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      log.warn({ url, status: response.status }, 'File download failed');
      return null;
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    log.error({ err: error, url }, 'File download error');
    return null;
  }
}
