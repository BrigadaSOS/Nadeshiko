import { describe, it, expect } from 'bun:test';
import { toSeiyuuWithRolesDTO } from '@app/controllers/mappers/seiyuu.mapper';
import { CharacterRole } from '@app/models/MediaCharacter';
import { SegmentStorage } from '@app/models/Segment';

function buildMedia(id: number, path: string) {
  return {
    id,
    externalIds: [],
    nameJa: `m-ja-${id}`,
    nameRomaji: `m-ro-${id}`,
    nameEn: `m-en-${id}`,
    airingFormat: 'TV',
    airingStatus: 'FINISHED',
    genres: ['Drama'],
    storage: SegmentStorage.R2,
    storageBasePath: path,
    startDate: '2024-01-01',
    endDate: null,
    category: 'ANIME',
    segmentCount: 1,
    episodes: [],
    studio: 'Studio',
    seasonName: 'SPRING',
    seasonYear: 2024,
  };
}

function buildSeiyuu(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    externalIds: { anilist: '1' },
    nameJapanese: 'sei-ja',
    nameEnglish: 'sei-en',
    imageUrl: 'https://example.com/sei.jpg',
    characters: [
      {
        id: 10,
        externalIds: { anilist: '10' },
        nameJapanese: 'char-ja',
        nameEnglish: 'char-en',
        imageUrl: 'https://example.com/char.jpg',
        mediaAppearances: [
          { role: CharacterRole.MAIN, media: buildMedia(5, 'path/a') },
          { role: CharacterRole.SUPPORTING, media: buildMedia(6, 'path/b') },
        ],
      },
    ],
    ...overrides,
  };
}

describe('seiyuu.mapper', () => {
  it('flattens character media appearances into role rows', () => {
    const dto = toSeiyuuWithRolesDTO(buildSeiyuu() as any);
    expect(dto.characters).toHaveLength(2);
    expect(dto.characters[0]).toMatchObject({
      id: 10,
      role: 'MAIN',
      media: { id: 5 },
    });
    expect(dto.characters[1]).toMatchObject({
      role: 'SUPPORTING',
      media: { id: 6 },
    });
  });

  it('returns empty characters when relation is not loaded', () => {
    const dto = toSeiyuuWithRolesDTO(buildSeiyuu({ characters: undefined }) as any);
    expect(dto.characters).toEqual([]);
  });
});
