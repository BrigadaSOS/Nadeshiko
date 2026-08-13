import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AudioFetchError, fetchAudioSegment } from './media';

const URL_UNDER_TEST = 'https://cdn.test/seg-1.mp3';

const ok = () => new Response('', { status: 200 });

describe('fetchAudioSegment', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('takes the cached response when the cache is not poisoned', async () => {
    fetchMock.mockResolvedValueOnce(ok());

    await expect(fetchAudioSegment(URL_UNDER_TEST)).resolves.toMatchObject({ cacheBypassed: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(URL_UNDER_TEST);
  });

  it('retries past a cache entry the media element poisoned', async () => {
    // What Chromium actually does: the player's `new Audio(url)` request is not a
    // CORS request, its response lands under the same cache key, and this
    // CORS-mode fetch is then refused with an opaque `TypeError: Failed to fetch`.
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(ok());

    await expect(fetchAudioSegment(URL_UNDER_TEST)).resolves.toMatchObject({ cacheBypassed: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(URL_UNDER_TEST, { cache: 'reload' });
  });

  it('reports the original rejection when the retry fails the same way', async () => {
    const original = new TypeError('Failed to fetch');
    fetchMock.mockRejectedValueOnce(original).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const error = await fetchAudioSegment(URL_UNDER_TEST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AudioFetchError);
    expect(error).toMatchObject({ url: URL_UNDER_TEST, kind: 'opaque' });
    expect((error as AudioFetchError).cause).toBe(original);
  });

  it('does not retry a status the CDN actually answered with', async () => {
    // 404 is a real answer; bypassing the cache cannot turn it into a file, and
    // retrying would only double the load on an object that is not there.
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));

    const error = await fetchAudioSegment(URL_UNDER_TEST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AudioFetchError);
    expect(error).toMatchObject({ kind: 'http', status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports the retry status when only the second request answers', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('', { status: 403 }));

    const error = await fetchAudioSegment(URL_UNDER_TEST).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'http', status: 403 });
  });
});
