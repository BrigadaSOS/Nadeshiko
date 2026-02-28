import { describe, it, expect } from 'bun:test';
import { shouldIncludeSearchMedia, toMediaSummary, toSearchResponseDTO } from '@app/controllers/mappers/search.mapper';
import { SegmentStorage } from '@app/models/Segment';

function buildMedia(overrides: Record<string, unknown> = {}) {
  return {
    id: 12,
    publicId: 'media-pid-12',
    externalIds: [{ source: 'ANILIST', externalId: '555' }],
    nameJa: 'ja',
    nameRomaji: 'romaji',
    nameEn: 'en',
    airingFormat: 'TV',
    airingStatus: 'FINISHED',
    genres: ['Action'],
    storage: SegmentStorage.R2,
    storageBasePath: 'shows/demo',
    startDate: '2024-01-01',
    endDate: '2024-02-02',
    category: 'ANIME',
    segmentCount: 10,
    episodes: [{ id: 1 }, { id: 2 }],
    seasonName: 'WINTER',
    seasonYear: 2024,
    studio: 'Studio',
    ...overrides,
  };
}

describe('search.mapper', () => {
  it('maps media summary fields', () => {
    const dto = toMediaSummary(buildMedia() as any);
    expect(dto.externalIds).toEqual({ anilist: '555' });
    expect(dto.episodeCount).toBe(2);
    expect(dto.characters).toEqual([]);
    expect(dto.coverUrl).toContain('/shows/demo/cover.webp');
    expect(dto.bannerUrl).toContain('/shows/demo/banner.webp');
  });

  it('uses episodeCount=0 when episodes relation is missing', () => {
    const dto = toMediaSummary(buildMedia({ episodes: undefined }) as any);
    expect(dto.episodeCount).toBe(0);
  });

  it('detects when media include is requested', () => {
    expect(shouldIncludeSearchMedia(['media'] as any)).toBe(true);
    expect(shouldIncludeSearchMedia([] as any)).toBe(false);
    expect(shouldIncludeSearchMedia(undefined)).toBe(false);
  });

  it('keeps includes when media include is present', () => {
    const result = {
      segments: [],
      includes: {
        media: {
          12: { id: 12 },
        },
      },
    };

    expect(toSearchResponseDTO(result as any, ['media'] as any)).toEqual(result);
  });

  it('strips media includes when media include is absent', () => {
    const result = {
      segments: [],
      includes: {
        media: {
          12: { id: 12 },
        },
      },
    };

    expect(toSearchResponseDTO(result as any, [] as any)).toEqual({
      segments: [],
      includes: { media: {} },
    });
  });
});
