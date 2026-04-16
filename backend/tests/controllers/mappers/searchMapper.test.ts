import { describe, it, expect } from 'bun:test';
import { shouldIncludeSearchMedia, toSearchResponseDTO } from '@app/controllers/mappers/searchMapper';

describe('search.mapper', () => {
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
    });
  });
});
