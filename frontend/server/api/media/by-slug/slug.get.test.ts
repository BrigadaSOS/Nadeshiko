import { describe, expect, it, vi } from 'vitest';

vi.mock('~~/server/utils/mediaSlugIndex', () => ({ resolveMediaSlug: vi.fn() }));

type FakeEvent = { params: Record<string, string>; path: string };
let cacheOptions: { getKey: (event: FakeEvent) => string; maxAge: number; swr: boolean } | undefined;
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('defineCachedEventHandler', (handler: unknown, options: typeof cacheOptions) => {
  cacheOptions = options;
  return handler;
});
vi.stubGlobal('getRouterParam', (event: FakeEvent, name: string) => event.params[name]);

await import('./[slug].get');

describe('the media-by-slug cache key', () => {
  const keyFor = (slug: string, path: string) => cacheOptions!.getKey({ params: { slug }, path });

  it('ignores the query string, so junk parameters cannot mint entries', () => {
    expect(keyFor('k-on', '/api/media/by-slug/k-on?x=1')).toBe(keyFor('k-on', '/api/media/by-slug/k-on'));
  });

  it('keeps slugs that differ only in punctuation apart', () => {
    expect(keyFor('k-on', '/api/media/by-slug/k-on')).not.toBe(keyFor('kon', '/api/media/by-slug/kon'));
  });

  it('keeps the day-long stale-while-revalidate policy the route rule had', () => {
    expect(cacheOptions).toMatchObject({ swr: true, maxAge: 86400 });
  });
});
