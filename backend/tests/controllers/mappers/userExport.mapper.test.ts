import { describe, it, expect } from 'bun:test';
import { toExportCollectionDTO, toUserExportDTO } from '@app/controllers/mappers/userExport.mapper';

function buildCollection(overrides: Record<string, unknown> = {}) {
  return {
    id: 8,
    name: 'Deck',
    userId: 1,
    visibility: 'PRIVATE',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-02T00:00:00.000Z'),
    segmentItems: [
      { position: 2, segmentUuid: 'seg-b' },
      { position: 1, segmentUuid: 'seg-a' },
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
    status: 'PENDING',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
  };
}

describe('userExport.mapper', () => {
  it('sorts segment uuids by position in export collection dto', () => {
    const dto = toExportCollectionDTO(buildCollection() as any);
    expect(dto.segmentUuids).toEqual(['seg-a', 'seg-b']);
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
    );

    expect(dto.profile).toEqual({
      id: 1,
      username: 'u1',
      email: 'u1@example.test',
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    expect(dto.activity).toHaveLength(1);
    expect(dto.collections[0].segmentUuids).toEqual(['seg-a', 'seg-b']);
    expect(dto.reports).toHaveLength(1);
  });
});
