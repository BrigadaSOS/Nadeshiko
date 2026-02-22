import { describe, it, expect } from 'bun:test';
import {
  toSeiyuuDTO,
  toCharacterDTO,
  toMediaCharacterDTO,
  toMediaBaseDTO,
} from '@app/controllers/mappers/shared.mapper';
import { CharacterRole } from '@app/models/MediaCharacter';
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
  it('maps seiyuu and character DTOs', () => {
    const seiyuu = toSeiyuuDTO({
      id: 9,
      externalIds: { anilist: '12' },
      nameJapanese: 'sei-ja',
      nameEnglish: 'sei-en',
      imageUrl: 'https://example.com/sei.jpg',
    } as any);

    const character = toCharacterDTO({
      id: 5,
      externalIds: { anilist: '99' },
      nameJapanese: 'char-ja',
      nameEnglish: 'char-en',
      imageUrl: 'https://example.com/char.jpg',
    } as any);

    expect(seiyuu.nameJa).toBe('sei-ja');
    expect(character.nameEn).toBe('char-en');
  });

  it('maps media character relation', () => {
    const dto = toMediaCharacterDTO({
      role: CharacterRole.SUPPORTING,
      character: {
        id: 6,
        nameJapanese: 'char-ja',
        nameEnglish: 'char-en',
        imageUrl: 'https://example.com/char.jpg',
        seiyuu: {
          id: 2,
          externalIds: { anilist: '1' },
          nameJapanese: 'sei-ja',
          nameEnglish: 'sei-en',
          imageUrl: 'https://example.com/sei.jpg',
        },
      },
    } as any);

    expect(dto.role).toBe('SUPPORTING');
    expect(dto.seiyuu.id).toBe(2);
  });

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
