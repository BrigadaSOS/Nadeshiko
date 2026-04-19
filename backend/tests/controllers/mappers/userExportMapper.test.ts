import { describe, it, expect } from 'bun:test';
import { toExportCollectionDTO, toUserExportDTO } from '@app/controllers/mappers/userExportMapper';

function buildCollection(overrides: Record<string, unknown> = {}) {
  return {
    id: 8,
    name: 'Deck',
    userId: 1,
    visibility: 'PRIVATE',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-02T00:00:00.000Z'),
    segmentItems: [
      { position: 2, segmentId: 2 },
      { position: 1, segmentId: 1 },
    ],
    ...overrides,
  };
}

function buildReport() {
  return {
    id: 5,
    source: 'USER',
    targetType: 'MEDIA',
    targetMediaId: 9,
    reason: 'OTHER',
    status: 'OPEN',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
  };
}

describe('userExport.mapper', () => {
  it('sorts segment ids by position in export collection dto', () => {
    const dto = toExportCollectionDTO(buildCollection() as any);
    expect(dto.segmentIds).toEqual([1, 2]);
    expect(dto.segmentCount).toBe(2);
  });

  it('maps complete user export payload', () => {
    const dto = toUserExportDTO(
      {
        id: 1,
        username: 'u1',
        email: 'u1@example.test',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        preferences: { searchHistory: { enabled: true } },
      } as any,
      [
        {
          id: 1,
          activityType: 'SEARCH',
          createdAt: new Date('2025-01-01T00:00:00.000Z'),
        },
      ] as any,
      [buildCollection()] as any,
      [buildReport()] as any,
      {
        media: new Map([[9, { publicId: 'media-pub-9', nameRomaji: 'Test Media' }]]),
        segments: new Map(),
      },
    );

    expect(dto.profile).toEqual({
      id: 1,
      username: 'u1',
      email: 'u1@example.test',
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    expect(dto.activity).toHaveLength(1);
    expect(dto.collections[0].segmentIds).toEqual([1, 2]);
    expect(dto.reports).toHaveLength(1);
  });
});
