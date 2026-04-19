import type { Segment, Media, SearchResponse, SearchStatsResponse, ContextResponse } from '../../api';

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U> ? Array<DeepPartial<U>> : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

let idCounter = 0;
function nextId() {
  return ++idCounter;
}

export function makeSegment(overrides: DeepPartial<Segment> = {}): Segment {
  const id = nextId();
  const publicId = overrides.publicId ?? `seg-${id}`;
  return {
    publicId,
    position: 1,
    status: 'ACTIVE',
    startTimeMs: 60000,
    endTimeMs: 63000,
    contentRating: 'SAFE',
    episode: 1,
    mediaPublicId: 'media-1',
    textJa: {
      content: 'テスト',
      highlight: 'テスト',
      tokens: [],
      ...overrides.textJa,
    },
    textEn: {
      content: 'Test',
      isMachineTranslated: false,
      highlight: 'Test',
      ...overrides.textEn,
    },
    textEs: {
      content: 'Prueba',
      isMachineTranslated: true,
      highlight: 'Prueba',
      ...overrides.textEs,
    },
    urls: {
      imageUrl: `https://example.com/${publicId}.jpg`,
      audioUrl: `https://example.com/${publicId}.mp3`,
      videoUrl: `https://example.com/${publicId}.mp4`,
      ...overrides.urls,
    },
    ...overrides,
  } as Segment;
}

export function makeMedia(overrides: DeepPartial<Media> = {}): Media {
  const id = nextId();
  return {
    publicId: overrides.publicId ?? `media-${id}`,
    slug: 'test-media',
    externalIds: {
      anilist: '',
      imdb: '',
      tvdb: '',
      tmdb: '',
    },
    nameJa: 'テストメディア',
    nameRomaji: 'Test Media',
    nameEn: 'Test Media',
    airingFormat: 'TV',
    airingStatus: 'FINISHED',
    genres: ['Action'],
    coverUrl: 'https://example.com/cover.jpg',
    bannerUrl: 'https://example.com/banner.jpg',
    startDate: '2024-01-01',
    endDate: '2024-03-01',
    category: 'ANIME',
    segmentCount: 1000,
    episodeCount: 12,
    studio: 'Test Studio',
    seasonName: 'WINTER',
    seasonYear: 2024,
    ...overrides,
  } as Media;
}

export function makeSearchResponse(
  segments: Segment[],
  mediaMap: Record<string, Media>,
  opts: { hasMore?: boolean; cursor?: string; estimatedTotalHits?: number } = {},
): SearchResponse {
  return {
    segments,
    includes: { media: mediaMap },
    pagination: {
      hasMore: opts.hasMore ?? false,
      estimatedTotalHits: opts.estimatedTotalHits ?? segments.length,
      estimatedTotalHitsRelation: 'EXACT',
      cursor: opts.cursor ?? '',
    },
  };
}

export function makeSearchStatsResponse(
  mediaStats: { mediaPublicId: string; matchCount: number }[],
  mediaMap: Record<string, Media>,
): SearchStatsResponse {
  return {
    media: mediaStats.map((m) => ({
      mediaPublicId: m.mediaPublicId,
      matchCount: m.matchCount,
      episodeHits: [],
    })),
    categories: [],
    includes: { media: mediaMap },
  };
}

export function makeContextResponse(segments: Segment[], mediaMap: Record<string, Media>): ContextResponse {
  return {
    segments,
    includes: { media: mediaMap },
  };
}
