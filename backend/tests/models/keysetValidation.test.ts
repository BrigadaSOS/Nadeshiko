import { describe, expect, it, vi } from 'vitest';
import { BaseEntity } from '@app/models/base.entity';
import { encodeKeysetCursor } from '@lib/cursor';
import { InvalidRequestError } from '@app/errors';

class Entity extends BaseEntity {}

describe('keyset cursor validation', () => {
  it.each(['\'><asdf alt="">-f3f3', '123', null, {}, [], 1.5, -1, 0, 2_147_483_648])(
    'rejects invalid primary key %j before any database query',
    async (id) => {
      const query = vi.fn();
      await expect(
        Entity.paginateWithKeyset({ take: 28, cursor: encodeKeysetCursor(id), query, count: true }),
      ).rejects.toBeInstanceOf(InvalidRequestError);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it.each([[new Date().toISOString(), 'bad-id'], [1], 123, null])(
    'rejects invalid compound cursor %j',
    async (cursor) => {
      const query = vi.fn();
      await expect(
        Entity.paginateWithKeyset({
          take: 28,
          cursor: encodeKeysetCursor(cursor),
          orderBy: { column: 'createdAt', direction: 'DESC' },
          query,
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it.each([123, ['2026-10-01T12:00:00Z', 123]])('uses valid cursor %j for pagination', async (cursor) => {
    const qb = {
      alias: 'entity',
      andWhere: vi.fn(),
      orderBy: vi.fn(),
      addOrderBy: vi.fn(),
      take: vi.fn(),
      getMany: vi.fn(async () => []),
    };
    await Entity.paginateWithKeyset({
      take: 28,
      cursor: encodeKeysetCursor(cursor),
      ...(Array.isArray(cursor) ? { orderBy: { column: 'createdAt', direction: 'DESC' as const } } : {}),
      query: () => qb as any,
    });
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.any(String),
      Array.isArray(cursor) ? { cp: cursor[0], ci: 123 } : { cursor: 123 },
    );
    expect(qb.getMany).toHaveBeenCalledOnce();
  });
});
