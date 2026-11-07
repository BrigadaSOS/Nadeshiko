import { NadeshikoError } from '@brigadasos/nadeshiko-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveMediaSlug, resolveStaleMediaSlug } from '~~/server/utils/mediaSlugIndex';

vi.mock('~~/server/utils/mediaSlugIndex', () => ({ resolveMediaSlug: vi.fn(), resolveStaleMediaSlug: vi.fn() }));

type FakeEvent = { params: Record<string, string>; path: string };
let cacheOptions: { getKey: (event: FakeEvent) => string; maxAge: number; swr: boolean } | undefined;
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('defineCachedEventHandler', (handler: unknown, options: typeof cacheOptions) => {
  cacheOptions = options;
  return handler;
});
vi.stubGlobal('getRouterParam', (event: FakeEvent, name: string) => event.params[name]);
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string }) =>
  Object.assign(new Error(input.statusMessage), input),
);

const getMedia = vi.fn();
vi.stubGlobal('useServerSdk', () => ({ getMedia }));

const handler = (await import('./[slug].get')).default as unknown as (event: FakeEvent) => Promise<unknown>;

const notFound = () => new NadeshikoError({ code: 'NOT_FOUND', status: 404, title: 'Not Found', detail: '' } as never);
const eventFor = (slug: string): FakeEvent => ({ params: { slug }, path: `/api/media/by-slug/${slug}` });

describe('the media-by-slug cache key', () => {
  const keyFor = (slug: string, path: string) => cacheOptions!.getKey({ params: { slug }, path });

  it('ignores the query string, so junk parameters cannot mint entries', () => {
    expect(keyFor('k-on', '/api/media/by-slug/k-on?x=1')).toBe(keyFor('k-on', '/api/media/by-slug/k-on'));
  });

  it('keeps slugs that differ only in punctuation apart', () => {
    expect(keyFor('k-on', '/api/media/by-slug/k-on')).not.toBe(keyFor('kon', '/api/media/by-slug/kon'));
  });

  it('serves stale-while-revalidate for five minutes, not a day', () => {
    expect(cacheOptions).toMatchObject({ swr: true, maxAge: 300 });
  });
});

describe('the media-by-slug handler', () => {
  beforeEach(() => {
    vi.mocked(resolveMediaSlug).mockReset();
    vi.mocked(resolveStaleMediaSlug).mockReset();
    getMedia.mockReset();
  });

  it('returns the media the slug resolves to', async () => {
    vi.mocked(resolveMediaSlug).mockResolvedValue('newnewnewnew');
    getMedia.mockResolvedValue({ publicId: 'newnewnewnew' });

    await expect(handler(eventFor('oregairu-1'))).resolves.toEqual({ publicId: 'newnewnewnew' });
    expect(resolveStaleMediaSlug).not.toHaveBeenCalled();
  });

  it('follows the slug to its new title when the indexed one was deleted and uploaded again', async () => {
    vi.mocked(resolveMediaSlug).mockResolvedValue('oldoldoldold');
    vi.mocked(resolveStaleMediaSlug).mockResolvedValue('newnewnewnew');
    getMedia.mockImplementation(async (id: string) => {
      if (id === 'oldoldoldold') throw notFound();
      return { publicId: id };
    });

    await expect(handler(eventFor('oregairu-1'))).resolves.toEqual({ publicId: 'newnewnewnew' });
    expect(resolveStaleMediaSlug).toHaveBeenCalledWith('oregairu-1', 'oldoldoldold', expect.anything());
  });

  it('is a 404 when the deleted title has no replacement', async () => {
    vi.mocked(resolveMediaSlug).mockResolvedValue('oldoldoldold');
    vi.mocked(resolveStaleMediaSlug).mockResolvedValue(null);
    getMedia.mockRejectedValue(notFound());

    await expect(handler(eventFor('oregairu-1'))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('does not treat other API failures as a deleted title', async () => {
    vi.mocked(resolveMediaSlug).mockResolvedValue('oldoldoldold');
    getMedia.mockRejectedValue(new Error('backend down'));

    await expect(handler(eventFor('oregairu-1'))).rejects.toThrow('backend down');
    expect(resolveStaleMediaSlug).not.toHaveBeenCalled();
  });
});
