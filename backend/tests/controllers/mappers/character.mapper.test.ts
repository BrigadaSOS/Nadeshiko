import { describe, it, expect } from 'bun:test';
import { toCharacterWithMediaDTO } from '@app/controllers/mappers/character.mapper';
import { CharacterRole } from '@app/models/MediaCharacter';
import { SegmentStorage } from '@app/models/Segment';

function buildCharacter(overrides: Record<string, unknown> = {}) {
  return {
    id: 9,
    externalIds: { anilist: '9' },
    nameJapanese: 'char-ja',
    nameEnglish: 'char-en',
    imageUrl: 'https://example.com/char.jpg',
    seiyuu: {
      id: 4,
      externalIds: { anilist: '4' },
      nameJapanese: 'sei-ja',
      nameEnglish: 'sei-en',
      imageUrl: 'https://example.com/sei.jpg',
    },
    mediaAppearances: [
      {
        role: CharacterRole.MAIN,
        media: {
          id: 3,
          externalIds: [],
          nameJa: 'm-ja',
          nameRomaji: 'm-ro',
          nameEn: 'm-en',
          airingFormat: 'TV',
          airingStatus: 'FINISHED',
          genres: ['Drama'],
          storage: SegmentStorage.R2,
          storageBasePath: 'media/m',
          startDate: '2024-01-01',
          endDate: null,
          category: 'ANIME',
          segmentCount: 1,
          episodes: [],
          studio: 'Studio',
          seasonName: 'SPRING',
          seasonYear: 2024,
        },
      },
    ],
    ...overrides,
  };
}

describe('character.mapper', () => {
  it('maps character with media appearances', () => {
    const dto = toCharacterWithMediaDTO(buildCharacter() as any);
    expect(dto.id).toBe(9);
    expect(dto.seiyuu.id).toBe(4);
    expect(dto.mediaAppearances).toHaveLength(1);
    expect(dto.mediaAppearances[0]).toMatchObject({
      role: 'MAIN',
      media: { id: 3 },
    });
  });

  it('returns empty media appearances when relation is not loaded', () => {
    const dto = toCharacterWithMediaDTO(buildCharacter({ mediaAppearances: undefined }) as any);
    expect(dto.mediaAppearances).toEqual([]);
  });
});
