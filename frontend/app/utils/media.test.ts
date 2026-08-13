import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioFetchError, describeAudioFetchFailure } from '~/utils/media';

const AUDIO_URL = 'https://cdn.nadeshiko.co/media/abc/0001.mp3';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Online unless a test says otherwise; `navigator.onLine` short-circuits the probe. */
function stubOnline(onLine: boolean) {
  vi.stubGlobal('navigator', { onLine });
}

describe('AudioFetchError', () => {
  // The url must stay off the message: it is the part that varies, and error
  // tracking fingerprints on the message, so including it would open a separate
  // issue per audio object and hide that they are all one fault.
  it('keeps the url out of the message and on the error', () => {
    const error = new AudioFetchError(AUDIO_URL, 'http', 404);

    expect(error.message).toBe('Audio segment request failed with status 404');
    expect(error.message).not.toContain(AUDIO_URL);
    expect(error.url).toBe(AUDIO_URL);
    expect(error.status).toBe(404);
  });

  it('describes an opaque failure without inventing a status', () => {
    const error = new AudioFetchError(AUDIO_URL, 'opaque');

    expect(error.message).toBe('Audio segment request failed before a response arrived');
    expect(error.status).toBeUndefined();
  });

  it('preserves the original rejection as the cause', () => {
    const cause = new TypeError('Failed to fetch');
    const error = new AudioFetchError(AUDIO_URL, 'opaque', undefined, { cause });

    expect(error.cause).toBe(cause);
  });
});

describe('describeAudioFetchFailure', () => {
  it('ignores an error it did not raise', async () => {
    expect(await describeAudioFetchFailure(new TypeError('Failed to fetch'))).toEqual({});
    expect(await describeAudioFetchFailure(null)).toEqual({});
  });

  it('reports an http failure without probing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    stubOnline(true);

    const attributes = await describeAudioFetchFailure(new AudioFetchError(AUDIO_URL, 'http', 503));

    expect(attributes).toEqual({
      'audio.url': AUDIO_URL,
      'audio.host': 'cdn.nadeshiko.co',
      'audio.failure': 'http',
      'http.status_code': '503',
    });
    // The server already answered, so there is nothing left to disambiguate.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The distinction the probe exists for. A `no-cors` request skips the CORS
  // check, so it resolving means the object was reachable all along and the
  // original request was refused over CORS -- the open question on issue #194.
  it('calls a reachable object a cors failure', async () => {
    // A real opaque response cannot be constructed here, and does not need to
    // be: the probe only cares that the request resolved at all.
    const fetchMock = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal('fetch', fetchMock);
    stubOnline(true);

    const attributes = await describeAudioFetchFailure(new AudioFetchError(AUDIO_URL, 'opaque'));

    expect(attributes['audio.opaque_cause']).toBe('cors');
    expect(attributes['http.status_code']).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(AUDIO_URL, expect.objectContaining({ method: 'HEAD', mode: 'no-cors' }));
  });

  it('calls an unreachable host unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    stubOnline(true);

    const attributes = await describeAudioFetchFailure(new AudioFetchError(AUDIO_URL, 'opaque'));

    expect(attributes['audio.opaque_cause']).toBe('unreachable');
  });

  // Probing an offline tab would fail a second time and report the wrong cause.
  it('trusts navigator.onLine over the probe', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    stubOnline(false);

    const attributes = await describeAudioFetchFailure(new AudioFetchError(AUDIO_URL, 'opaque'));

    expect(attributes['audio.opaque_cause']).toBe('offline');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('survives a url it cannot parse', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response()));
    stubOnline(true);

    const attributes = await describeAudioFetchFailure(new AudioFetchError('not-a-url', 'opaque'));

    expect(attributes['audio.host']).toBe('unparseable');
  });
});
