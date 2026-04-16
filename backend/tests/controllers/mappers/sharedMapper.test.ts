import { describe, it, expect } from 'bun:test';
import { toMediaBaseDTO } from '@app/controllers/mappers/sharedMapper';
import { SegmentStorage } from '@app/models/Segment';

function buildMedia(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    externalIds: [{ source: 'ANILIST', externalId: '123' }],
    nameJa: 'name-ja',
    nameRomaji: 'name-ro',
    nameEn: 'name-en',
    airingFormat: 'TV',
    airingStatus: 'FINISHED',
    genres: ['Comedy'],
    storage: SegmentStorage.R2,
    startDate: new Date('2024-02-03T00:00:00.000Z'),
    endDate: null,
    category: 'ANIME',
    segmentCount: 7,
    episodes: [{ id: 1 }, { id: 2 }, { id: 3 }],
    studio: 'Studio',
    seasonName: 'SPRING',
    seasonYear: 2024,
    storageBasePath: 'media/base',
    ...overrides,
  };
}

describe('shared.mapper', () => {
  it('maps base media with normalized dates and external ids', () => {
    const dto = toMediaBaseDTO(buildMedia() as any);
    expect(dto.externalIds).toEqual({ anilist: '123' });
    expect(dto.startDate).toBe('2024-02-03');
    expect(dto.endDate).toBeNull();
    expect(dto.episodeCount).toBe(3);
    expect(dto.coverUrl).toContain('/media/base/cover.webp');
    expect(dto.bannerUrl).toContain('/media/base/banner.webp');
  });
});
