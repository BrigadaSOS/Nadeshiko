import { describe, it, expect } from 'vitest';

import { useCursorPagination } from '../useCursorPagination';
import { deferred } from './deferred';

type Page = { items: string[]; cursor: string | null; hasMore?: boolean };

const page = (items: string[], cursor: string | null, hasMore = cursor !== null): Page => ({ items, cursor, hasMore });

describe('useCursorPagination', () => {
  it('tracks the cursor and end of the list from the accepted page', async () => {
    const pagination = useCursorPagination();

    const first = await pagination.load(async () => page(['a'], 'cursor-1'));
    expect(first).toEqual({ status: 'ok', page: page(['a'], 'cursor-1') });
    expect(pagination.cursor.value).toBe('cursor-1');
    expect(pagination.hasMore.value).toBe(true);

    const last = await pagination.loadMore(async (cursor) => {
      expect(cursor).toBe('cursor-1');
      return page(['b'], null);
    });
    expect(last.status).toBe('ok');
    expect(pagination.cursor.value).toBeNull();
    expect(pagination.hasMore.value).toBe(false);
  });

  it('falls back to cursor presence for endpoints that send no hasMore', async () => {
    const pagination = useCursorPagination();

    await pagination.load(async () => ({ items: ['a'], cursor: 'cursor-1' }));
    expect(pagination.hasMore.value).toBe(true);

    await pagination.loadMore(async () => ({ items: ['b'], cursor: '' }));
    expect(pagination.cursor.value).toBeNull();
    expect(pagination.hasMore.value).toBe(false);
  });

  it('drops an in-flight append once a fresh list is started', async () => {
    const pagination = useCursorPagination();
    await pagination.load(async () => page(['old-1'], 'old-cursor'));

    const slowAppend = deferred<Page>();
    const append = pagination.loadMore(() => slowAppend.promise);

    // The filter changed underneath the append: the new list owns the state now.
    const reload = await pagination.load(async () => page(['new-1'], 'new-cursor'));
    slowAppend.resolve(page(['old-2'], 'stale-cursor'));

    expect(await append).toEqual({ status: 'stale' });
    expect(reload.status).toBe('ok');
    expect(pagination.cursor.value).toBe('new-cursor');
    expect(pagination.loading.value).toBe(false);
    expect(pagination.loadingMore.value).toBe(false);
  });

  it('lets the newer of two reloads win', async () => {
    const pagination = useCursorPagination();

    const slow = deferred<Page>();
    const first = pagination.load(() => slow.promise);
    const second = await pagination.load(async () => page(['new'], 'new-cursor'));
    slow.resolve(page(['old'], 'old-cursor'));

    expect(await first).toEqual({ status: 'stale' });
    expect(second.status).toBe('ok');
    expect(pagination.cursor.value).toBe('new-cursor');
  });

  it('steps aside instead of cancelling when an append is already running', async () => {
    const pagination = useCursorPagination();
    await pagination.load(async () => page(['a'], 'cursor-1'));

    const slow = deferred<Page>();
    const first = pagination.loadMore(() => slow.promise);
    const second = await pagination.loadMore(async () => page(['never'], 'never'));

    expect(second).toEqual({ status: 'stale' });
    slow.resolve(page(['b'], 'cursor-2'));
    expect((await first).status).toBe('ok');
    expect(pagination.cursor.value).toBe('cursor-2');
  });

  it('refuses to append past the end of the list', async () => {
    const pagination = useCursorPagination();
    await pagination.load(async () => page(['a'], null));

    expect(await pagination.loadMore(async () => page(['b'], null))).toEqual({ status: 'stale' });
  });

  it('keeps the cursor and clears the in-flight flags when a page fails', async () => {
    const pagination = useCursorPagination();
    await pagination.load(async () => page(['a'], 'cursor-1'));

    expect(await pagination.loadMore(async () => null)).toEqual({ status: 'error' });
    expect(pagination.cursor.value).toBe('cursor-1');
    expect(pagination.hasMore.value).toBe(true);
    expect(pagination.loadingMore.value).toBe(false);
  });

  it('clears the in-flight flags when a fetcher rejects', async () => {
    const pagination = useCursorPagination();

    await expect(
      pagination.load(async () => {
        throw new Error('network down');
      }),
    ).rejects.toThrow('network down');
    expect(pagination.loading.value).toBe(false);
  });

  it('seed() adopts a page and invalidates anything in flight', async () => {
    const pagination = useCursorPagination();

    const slow = deferred<Page>();
    const inFlight = pagination.load(() => slow.promise);

    pagination.seed({ cursor: 'seeded-cursor', hasMore: true });
    slow.resolve(page(['stale'], 'stale-cursor'));

    expect(await inFlight).toEqual({ status: 'stale' });
    expect(pagination.cursor.value).toBe('seeded-cursor');
    expect(pagination.hasMore.value).toBe(true);
    expect(pagination.loading.value).toBe(false);
  });

  it('seed(null) empties the list state', () => {
    const pagination = useCursorPagination();

    pagination.seed(null);

    expect(pagination.cursor.value).toBeNull();
    expect(pagination.hasMore.value).toBe(false);
  });
});
