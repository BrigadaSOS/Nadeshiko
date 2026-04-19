import { describe, it, expect } from 'bun:test';
import {
  toMediaCreateAttributes,
  toMediaDTO,
  toMediaExternalIdAttributes,
  toMediaListDTO,
  toMediaUpdatePatch,
} from '@app/controllers/mappers/mediaMapper';
import { CategoryType } from '@app/models/Media';
import { ExternalSourceType } from '@app/models/MediaExternalId';
import { SegmentStorage } from '@app/models/Segment';

function buildMedia(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    publicId: 'media-pid-1',
    nameJa: 'name-ja',
    nameRomaji: 'name-romaji',
    nameEn: 'name-en',
    airingFormat: 'TV',
    airingStatus: 'FINISHED',
    genres: ['Drama'],
    storage: SegmentStorage.R2,
    startDate: '2024-01-01',
    endDate: '2024-06-01',
    studio: 'Studio',
    seasonName: 'SPRING',
    seasonYear: 2024,
    category: 'ANIME',
    segmentCount: 10,
    storageBasePath: 'show/path',
    episodes: [{ id: 1 }, { id: 2 }],
    externalIds: [
      { source: 'ANILIST', externalId: '123' },
      { source: 'IMDB', externalId: 'tt0001' },
    ],
    ...overrides,
  };
}

describe('media.mapper', () => {
  it('maps media fields including externalIds', () => {
    const dto = toMediaDTO(buildMedia() as any);
    expect(dto.externalIds).toEqual({ anilist: '123', imdb: 'tt0001', tmdb: null, tvdb: null });
    expect(dto.publicId).toBe('media-pid-1');
  });

  it('maps a media list', () => {
    const list = toMediaListDTO([buildMedia({ publicId: 'a' }), buildMedia({ publicId: 'b' })] as any);
    expect(list).toHaveLength(2);
    expect(list[0].publicId).toBe('a');
    expect(list[1].publicId).toBe('b');
  });

  it('maps external ids object to relation attributes', () => {
    const attrs = toMediaExternalIdAttributes({
      anilist: '123',
      imdb: 'tt001',
    });

    expect(attrs).toEqual([
      { source: ExternalSourceType.ANILIST, externalId: '123' },
      { source: ExternalSourceType.IMDB, externalId: 'tt001' },
    ]);
  });

  it('maps media create body to media attributes', () => {
    const attrs = toMediaCreateAttributes({
      nameJa: 'ja',
      nameRomaji: 'romaji',
      nameEn: 'en',
      airingFormat: 'TV',
      airingStatus: 'FINISHED',
      genres: ['Drama'],
      storage: 'LOCAL',
      startDate: '2024-01-01',
      category: 'JDRAMA',
      version: 'v1',
      hashSalt: 'salt',
      studio: 'Studio',
      seasonName: 'WINTER',
      seasonYear: 2024,
      storageBasePath: 'media/1',
      externalIds: { tvdb: 'tv-1' },
    } as any);

    expect(attrs).toMatchObject({
      nameJa: 'ja',
      nameRomaji: 'romaji',
      nameEn: 'en',
      storage: SegmentStorage.LOCAL,
      category: CategoryType.JDRAMA,
      storageBasePath: 'media/1',
      externalIds: [{ source: ExternalSourceType.TVDB, externalId: 'tv-1' }],
    });
  });

  it('maps media update patch and removes undefined fields', () => {
    const patch = toMediaUpdatePatch({
      nameEn: 'updated',
      storage: 'LOCAL',
      seasonYear: 2025,
      segmentCount: 9999,
    } as any);

    expect(patch).toEqual({
      nameEn: 'updated',
      storage: SegmentStorage.LOCAL,
      seasonYear: 2025,
    });
  });
});
