import { describe, it, expect } from 'vitest';
import { toUserActivityDTO, toUserActivityListDTO } from '@app/controllers/mappers/activityMapper';
import { ActivityType } from '@app/models/UserActivity';

function buildActivity(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    activityType: ActivityType.SEARCH,
    segmentId: null,
    mediaPublicId: 'media-pub-42',
    searchQuery: 'query',
    mediaName: 'Show',
    japaneseText: 'text',
    createdAt: new Date('2025-01-02T03:04:05.000Z'),
    ...overrides,
  };
}

describe('activity.mapper', () => {
  it('maps a single activity', () => {
    const dto = toUserActivityDTO(buildActivity() as any);
    expect(dto).toEqual({
      id: 1,
      activityType: 'SEARCH',
      segmentPublicId: null,
      mediaPublicId: 'media-pub-42',
      searchQuery: 'query',
      mediaName: 'Show',
      japaneseText: 'text',
      createdAt: '2025-01-02T03:04:05.000Z',
    });
  });

  // Rows written before the write path normalized them still hold `''`, and the
  // response schema requires `minLength: 1` -- one of them used to fail validation
  // for the entire page rather than for its own row.
  it('reads blank metadata as absent rather than as an empty value', () => {
    const dto = toUserActivityDTO(
      buildActivity({ mediaName: '', searchQuery: '   ', japaneseText: '', segmentId: '' }) as any,
    );

    expect(dto.mediaName).toBeNull();
    expect(dto.searchQuery).toBeNull();
    expect(dto.japaneseText).toBeNull();
    expect(dto.segmentPublicId).toBeNull();
    expect(dto.mediaPublicId).toBe('media-pub-42');
  });

  it('maps a list of activities', () => {
    const list = toUserActivityListDTO([
      buildActivity({ id: 1 }),
      buildActivity({ id: 2, mediaPublicId: null }),
    ] as any);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(1);
    expect(list[1].id).toBe(2);
  });
});
