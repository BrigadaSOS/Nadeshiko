import { describe, it, expect } from 'bun:test';
import { toCollectionDTO } from '@app/controllers/mappers/collection.mapper';

function buildCollection(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    name: 'Deck',
    userId: 22,
    visibility: 'PRIVATE',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('collection.mapper', () => {
  it('uses default segmentCount = 0', () => {
    const dto = toCollectionDTO(buildCollection() as any);
    expect(dto.segmentCount).toBe(0);
  });

  it('maps collection fields with explicit segmentCount', () => {
    const dto = toCollectionDTO(buildCollection({ visibility: 'PUBLIC' }) as any, 3);
    expect(dto).toEqual({
      id: 7,
      name: 'Deck',
      visibility: 'PUBLIC',
      segmentCount: 3,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
    });
  });
});
