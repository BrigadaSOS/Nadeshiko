import { describe, it, expect } from 'bun:test';
import { toUserActivityDTO, toUserActivityListDTO } from '@app/controllers/mappers/activity.mapper';
import { ActivityType } from '@app/models/UserActivity';

function buildActivity(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    activityType: ActivityType.SEARCH,
    segmentId: null,
    mediaId: 42,
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
      segmentId: null,
      mediaId: 42,
      searchQuery: 'query',
      mediaName: 'Show',
      japaneseText: 'text',
      createdAt: '2025-01-02T03:04:05.000Z',
    });
  });

  it('maps a list of activities', () => {
    const list = toUserActivityListDTO([buildActivity({ id: 1 }), buildActivity({ id: 2 })] as any);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(1);
    expect(list[1].id).toBe(2);
  });
});
