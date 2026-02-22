import { describe, it, expect } from 'bun:test';
import { toSeriesDTO, toSeriesListDTO, toSeriesWithMediaDTO } from '@app/controllers/mappers/series.mapper';
import { SegmentStorage } from '@app/models/Segment';

function buildMedia(id: number) {
  return {
    id,
    externalIds: [],
    nameJa: `m-ja-${id}`,
    nameRomaji: `m-ro-${id}`,
    nameEn: `m-en-${id}`,
    airingFormat: 'TV',
    airingStatus: 'FINISHED',
    genres: ['Action'],
    storage: SegmentStorage.R2,
    storageBasePath: `series/media/${id}`,
    startDate: '2024-01-01',
    endDate: null,
    category: 'ANIME',
    segmentCount: 2,
    episodes: [],
    studio: 'Studio',
    seasonName: 'WINTER',
    seasonYear: 2024,
    characters: undefined,
  };
}

function buildSeries(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    nameJa: 'series-ja',
    nameRomaji: 'series-ro',
    nameEn: 'series-en',
    mediaEntries: [{ position: 2, media: buildMedia(11) }],
    ...overrides,
  };
}

describe('series.mapper', () => {
  it('maps base series and list', () => {
    const dto = toSeriesDTO(buildSeries() as any);
    const list = toSeriesListDTO([buildSeries({ id: 1 }), buildSeries({ id: 2 })] as any);
    expect(dto).toEqual({ id: 3, nameJa: 'series-ja', nameRomaji: 'series-ro', nameEn: 'series-en' });
    expect(list.map((item) => item.id)).toEqual([1, 2]);
  });

  it('maps series with media entries and falls back to empty list', () => {
    const withMedia = toSeriesWithMediaDTO(buildSeries() as any);
    expect(withMedia.media).toHaveLength(1);
    expect(withMedia.media[0]).toMatchObject({ position: 2, media: { id: 11 } });

    const withoutMedia = toSeriesWithMediaDTO(buildSeries({ mediaEntries: undefined }) as any);
    expect(withoutMedia.media).toEqual([]);
  });
});
