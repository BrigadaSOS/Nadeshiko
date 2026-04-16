import { describe, it, expect, beforeEach } from 'bun:test';
import { toEpisodeDTO, toEpisodeListDTO } from '@app/controllers/mappers/episodeMapper';

let seq = 0;

function buildEpisode(overrides: Record<string, unknown> = {}) {
  seq++;
  return {
    mediaId: 1,
    episodeNumber: seq,
    titleEn: `Episode ${seq}`,
    titleRomaji: null,
    titleJa: null,
    description: null,
    airedAt: new Date('2024-01-15T00:00:00Z'),
    lengthSeconds: 1440,
    thumbnailUrl: null,
    segmentCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  seq = 0;
});

describe('toEpisodeDTO', () => {
  it('maps all fields correctly', () => {
    const dto = toEpisodeDTO(
      buildEpisode({
        episodeNumber: 3,
        titleEn: 'The Storm',
        titleRomaji: 'Arashi',
        titleJa: '嵐',
        description: 'A big storm',
        airedAt: new Date('2024-06-01T00:00:00Z'),
        lengthSeconds: 1320,
        thumbnailUrl: 'https://example.com/thumb.jpg',
        segmentCount: 42,
      }) as any,
      'media-public-5',
    );

    expect(dto).toEqual({
      mediaPublicId: 'media-public-5',
      episodeNumber: 3,
      titleEn: 'The Storm',
      titleRomaji: 'Arashi',
      titleJa: '嵐',
      description: 'A big storm',
      airedAt: '2024-06-01T00:00:00.000Z',
      lengthSeconds: 1320,
      thumbnailUrl: 'https://example.com/thumb.jpg',
      segmentCount: 42,
    });
  });

  it('converts Date airedAt to ISO string', () => {
    const dto = toEpisodeDTO(buildEpisode({ airedAt: new Date('2025-03-20T12:30:00Z') }) as any, 'mid');
    expect(dto.airedAt).toBe('2025-03-20T12:30:00.000Z');
  });

  it('handles undefined optional fields', () => {
    const dto = toEpisodeDTO(
      buildEpisode({
        titleEn: undefined,
        titleRomaji: undefined,
        titleJa: undefined,
        description: undefined,
        airedAt: undefined,
        lengthSeconds: undefined,
        thumbnailUrl: undefined,
      }) as any,
      'mid',
    );

    expect(dto.titleEn).toBeUndefined();
    expect(dto.airedAt).toBeUndefined();
    expect(dto.lengthSeconds).toBeUndefined();
    expect(dto.thumbnailUrl).toBeUndefined();
  });
});

describe('toEpisodeListDTO', () => {
  it('maps array of episodes', () => {
    const dtos = toEpisodeListDTO([buildEpisode(), buildEpisode(), buildEpisode()] as any, 'mid');

    expect(dtos).toHaveLength(3);
    expect(dtos[0].episodeNumber).toBe(1);
    expect(dtos[1].episodeNumber).toBe(2);
    expect(dtos[2].episodeNumber).toBe(3);
  });
});
