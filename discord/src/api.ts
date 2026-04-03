import { BOT_CONFIG } from './config';

type SearchBody = {
  query: { search: string; exactMatch?: boolean };
  filters?: Record<string, unknown>;
  sort?: { mode?: string; seed?: number };
  take?: number;
  cursor?: string;
  include?: string[];
};

export type Segment = {
  id: number;
  publicId: string;
  uuid: string;
  position: number;
  startTimeMs: number;
  endTimeMs: number;
  episode: number;
  mediaId: number;
  mediaPublicId: string;
  textJa: { content: string; highlight?: string };
  textEn: { content: string; isMachineTranslated: boolean; highlight?: string };
  textEs: { content: string; isMachineTranslated: boolean; highlight?: string };
  contentRating: string;
  urls: { imageUrl: string; audioUrl: string; videoUrl: string };
};

export type MediaInfo = {
  id: number;
  publicId: string;
  slug: string;
  nameJa: string;
  nameRomaji: string;
  nameEn: string;
  airingFormat: string;
  category: string;
  coverUrl: string;
  bannerUrl: string;
  segmentCount: number;
  episodeCount: number;
  studio: string;
};

export type SearchResponse = {
  segments: Segment[];
  includes: { media: Record<string, MediaInfo> };
  pagination: {
    hasMore: boolean;
    estimatedTotalHits: number;
    estimatedTotalHitsRelation: string;
    cursor: string | null;
  };
};

export type ContextResponse = {
  segments: Segment[];
  includes: { media: Record<string, MediaInfo> };
};

export type StatsResponse = {
  totalSegments: number;
  totalEpisodes: number;
  totalMedia: number;
  totalFrequencyWords: number;
  dialogueHours: number;
  tiers: { tier: number; covered: number; total: number; percentage: number }[];
  translations: {
    total: number;
    enHuman: number;
    enMachine: number;
    esHuman: number;
    esMachine: number;
  };
};

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${BOT_CONFIG.apiBaseUrl}/v1${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${BOT_CONFIG.apiKey}`,
    ...((options.headers as Record<string, string>) ?? {}),
  };

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`API ${response.status}: ${text.slice(0, 200)}`);
  }

  return response.json() as Promise<T>;
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
  const body: SearchBody = {
    query: { search: query, exactMatch: options.exactMatch },
    take: options.take ?? BOT_CONFIG.maxSearchResults,
    include: ['media'],
    filters: {
      status: ['ACTIVE', 'VERIFIED'],
      ...(options.category ? { category: [options.category] } : {}),
    },
  };

  if (options.cursor) body.cursor = options.cursor;

  if (options.sort) {
    body.sort = { mode: options.sort };
    if (options.sort === 'RANDOM' && options.seed) {
      body.sort.seed = options.seed;
    }
  }

  return apiFetch<SearchResponse>('/search', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function getSegmentContext(uuid: string, take = 5): Promise<ContextResponse> {
  return apiFetch<ContextResponse>(`/media/segments/${encodeURIComponent(uuid)}/context?take=${take}`);
}

export async function getSegmentByUuid(uuid: string): Promise<{ segment: Segment; media: MediaInfo | null }> {
  const data = await apiFetch<any>(`/media/segments/${encodeURIComponent(uuid)}?include=media`);

  const segment = data as Segment;
  const media =
    segment.mediaPublicId && data.includes?.media?.[segment.mediaPublicId]
      ? data.includes.media[segment.mediaPublicId]
      : null;

  return { segment, media };
}

export async function getStats(): Promise<StatsResponse> {
  return apiFetch<StatsResponse>('/stats/overview');
}

export async function downloadFile(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}
