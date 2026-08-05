import { describe, test, expect, vi } from 'vitest';
import { paginate } from './paginate';

type Page = { items: string[]; pagination: { hasMore: boolean; cursor: string | null } };

function makeApiCall(pages: Page[]) {
  let call = 0;
  return vi.fn(async (_options: any) => ({ data: pages[call++] }));
}

function extract(data: Page) {
  return { items: data.items, pagination: data.pagination };
}

describe('paginate', () => {
  test('yields all items from a single page', async () => {
    const fn = makeApiCall([{ items: ['a', 'b', 'c'], pagination: { hasMore: false, cursor: null } }]);
    const results: string[] = [];
    for await (const item of paginate(fn, {}, extract)) results.push(item);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('yields all items across multiple pages', async () => {
    const fn = makeApiCall([
      { items: ['a', 'b'], pagination: { hasMore: true, cursor: 'cursor1' } },
      { items: ['c', 'd'], pagination: { hasMore: true, cursor: 'cursor2' } },
      { items: ['e'],      pagination: { hasMore: false, cursor: null } },
    ]);

    const results: string[] = [];
    for await (const item of paginate(fn, {}, extract)) results.push(item);
    expect(results).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('patches cursor into body on subsequent pages', async () => {
    const fn = makeApiCall([
      { items: ['x'], pagination: { hasMore: true, cursor: 'abc' } },
      { items: ['y'], pagination: { hasMore: false, cursor: null } },
    ]);

    for await (const _ of paginate(fn, { body: { query: 'test' } }, extract)) {}

    expect(fn.mock.calls[0][0]).toEqual({ body: { query: 'test' } });
    expect(fn.mock.calls[1][0]).toEqual({ body: { query: 'test', cursor: 'abc' } });
  });

  test('patches cursor into query when no body present', async () => {
    const fn = makeApiCall([
      { items: ['x'], pagination: { hasMore: true, cursor: 'def' } },
      { items: ['y'], pagination: { hasMore: false, cursor: null } },
    ]);

    for await (const _ of paginate(fn, { query: { limit: 10 } }, extract)) {}

    expect(fn.mock.calls[1][0]).toEqual({ query: { limit: 10, cursor: 'def' } });
  });

  test('falls back to body: { cursor } when no body or query present', async () => {
    const fn = makeApiCall([
      { items: ['x'], pagination: { hasMore: true, cursor: 'ghi' } },
      { items: ['y'], pagination: { hasMore: false, cursor: null } },
    ]);

    for await (const _ of paginate(fn, {}, extract)) {}

    expect(fn.mock.calls[1][0]).toEqual({ body: { cursor: 'ghi' } });
  });

  test('first call uses original options unchanged', async () => {
    const fn = makeApiCall([{ items: [], pagination: { hasMore: false, cursor: null } }]);
    const options = { body: { search: '猫' }, query: { limit: 5 } };
    for await (const _ of paginate(fn, options, extract)) {}
    expect(fn.mock.calls[0][0]).toBe(options);
  });

  test('stops when hasMore is false', async () => {
    const fn = makeApiCall([
      { items: ['a'], pagination: { hasMore: false, cursor: 'leftover' } },
    ]);
    const results: string[] = [];
    for await (const item of paginate(fn, {}, extract)) results.push(item);
    expect(results).toEqual(['a']);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('stops when cursor is null even if hasMore is true', async () => {
    const fn = makeApiCall([
      { items: ['a'], pagination: { hasMore: true, cursor: null } },
    ]);
    const results: string[] = [];
    for await (const item of paginate(fn, {}, extract)) results.push(item);
    expect(results).toEqual(['a']);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('handles empty items array', async () => {
    const fn = makeApiCall([{ items: [], pagination: { hasMore: false, cursor: null } }]);
    const results: string[] = [];
    for await (const item of paginate(fn, {}, extract)) results.push(item);
    expect(results).toEqual([]);
  });

  test('throws when api returns error', async () => {
    const fn = vi.fn(async () => ({ error: new Error('unauthorized') }));
    await expect(async () => {
      for await (const _ of paginate(fn, {}, extract)) {}
    }).rejects.toThrow('unauthorized');
  });
});
