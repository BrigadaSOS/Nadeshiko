import type { Segment, Media, SearchResponse, SearchStatsResponse, ContextResponse } from '../../api';

let idCounter = 0;
function nextId() {
  return ++idCounter;
}

export function makeSegment(overrides: Partial<Segment> = {}): Segment {
  const id = nextId();
  const publicId = overrides.publicId ?? `seg-${id}`;
  return {
    id,
    uuid: `uuid-${id}`,
    publicId,
    position: 1,
    status: 'ACTIVE',
    startTimeMs: 60000,
    endTimeMs: 63000,
    contentRating: 'SAFE',
    episode: 1,
    mediaId: 1,
    mediaPublicId: 'media-1',
    textJa: { content: 'テスト' },
    textEn: { content: 'Test', isMachineTranslated: false },
    textEs: { content: 'Prueba', isMachineTranslated: true },
    urls: {
      imageUrl: `https://example.com/${publicId}.jpg`,
      audioUrl: `https://example.com/${publicId}.mp3`,
      videoUrl: `https://example.com/${publicId}.mp4`,
    },
    ...overrides,
  } as Segment;
}

export function makeMedia(overrides: Partial<Media> = {}): Media {
  const id = nextId();
  return {
    id,
    publicId: overrides.publicId ?? `media-${id}`,
    slug: 'test-media',
    externalIds: {},
    nameJa: 'テストメディア',
    nameRomaji: 'Test Media',
    nameEn: 'Test Media',
    airingFormat: 'TV',
    airingStatus: 'FINISHED',
    genres: ['Action'],
    coverUrl: 'https://example.com/cover.jpg',
    bannerUrl: 'https://example.com/banner.jpg',
    startDate: '2024-01-01',
    category: 'ANIME',
    segmentCount: 1000,
    episodeCount: 12,
    seasonName: 'Winter',
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
  mediaStats: { publicId: string; matchCount: number }[],
  mediaMap: Record<string, Media>,
): SearchStatsResponse {
  return {
    media: mediaStats.map((m, i) => ({
      mediaId: i + 1,
      publicId: m.publicId,
      matchCount: m.matchCount,
      episodeHits: {},
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
