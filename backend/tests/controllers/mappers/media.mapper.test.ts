import { describe, it, expect } from 'bun:test';
import {
  toCharacterEntity,
  toMediaCreateAttributes,
  toMediaDTO,
  toMediaExternalIdAttributes,
  toMediaListDTO,
  toMediaUpdatePatch,
} from '@app/controllers/mappers/media.mapper';
import { CharacterRole } from '@app/models/MediaCharacter';
import { CategoryType } from '@app/models/Media';
import { ExternalSourceType } from '@app/models/MediaExternalId';
import { SegmentStorage } from '@app/models/Segment';

function buildMedia(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
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
  it('maps media without characters when relation is not loaded', () => {
    const dto = toMediaDTO(buildMedia({ characters: undefined }) as any);
    expect(dto.characters).toBeUndefined();
    expect(dto.externalIds).toEqual({ anilist: '123', imdb: 'tt0001' });
  });

  it('maps media with character relation', () => {
    const media = buildMedia({
      characters: [
        {
          role: CharacterRole.MAIN,
          character: {
            id: 99,
            nameJapanese: 'char-ja',
            nameEnglish: 'char-en',
            imageUrl: 'https://example.com/char.jpg',
            seiyuu: {
              id: 55,
              externalIds: { anilist: '321' },
              nameJapanese: 'sei-ja',
              nameEnglish: 'sei-en',
              imageUrl: 'https://example.com/sei.jpg',
            },
          },
        },
      ],
    });

    const dto = toMediaDTO(media as any);
    expect(dto.characters).toHaveLength(1);
    expect(dto.characters?.[0]).toMatchObject({
      id: 99,
      nameJa: 'char-ja',
      nameEn: 'char-en',
      role: 'MAIN',
      seiyuu: {
        id: 55,
        nameJa: 'sei-ja',
      },
    });
  });

  it('maps a media list', () => {
    const list = toMediaListDTO([buildMedia({ id: 1 }), buildMedia({ id: 2 })] as any);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(1);
    expect(list[1].id).toBe(2);
  });

  it('maps character input into nested entity shape', () => {
    const entity = toCharacterEntity({
      role: 'MAIN',
      externalIds: { anilist: 'c-77' },
      nameJa: 'char-ja',
      nameEn: 'char-en',
      imageUrl: 'https://example.com/char.jpg',
      seiyuu: {
        externalIds: { anilist: 's-11' },
        nameJa: 'sei-ja',
        nameEn: 'sei-en',
        imageUrl: 'https://example.com/sei.jpg',
      },
    } as any);

    expect(entity).toEqual({
      role: 'MAIN',
      character: {
        externalIds: { anilist: 'c-77' },
        nameJapanese: 'char-ja',
        nameEnglish: 'char-en',
        imageUrl: 'https://example.com/char.jpg',
        seiyuu: {
          externalIds: { anilist: 's-11' },
          nameJapanese: 'sei-ja',
          nameEnglish: 'sei-en',
          imageUrl: 'https://example.com/sei.jpg',
        },
      },
    });
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
      characters: [],
    } as any);

    expect(patch).toEqual({
      nameEn: 'updated',
      storage: SegmentStorage.LOCAL,
      seasonYear: 2025,
    });
  });
});
