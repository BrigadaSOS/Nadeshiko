import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  anilistAnimeUrl,
  AudioFetchError,
  copyToClipboard,
  describeAudioFetchFailure,
  fetchAudioSegment,
  imdbTitleUrl,
  mediaSameAsUrls,
  tmdbUrl,
  youtubeChannelUrl,
  youtubeWatchUrl,
} from '~/utils/media';

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

describe('anilistAnimeUrl', () => {
  it('points at the anime page for that id', () => {
    expect(anilistAnimeUrl('100077')).toBe('https://anilist.co/anime/100077');
  });
});

describe('tmdbUrl', () => {
  it('uses /movie/ only for movies', () => {
    expect(tmdbUrl('550', 'MOVIE')).toBe('https://www.themoviedb.org/movie/550');
  });

  it('uses /tv/ for every other format', () => {
    expect(tmdbUrl('233452', 'TV')).toBe('https://www.themoviedb.org/tv/233452');
    expect(tmdbUrl('1', 'OVA')).toBe('https://www.themoviedb.org/tv/1');
  });
});

describe('imdbTitleUrl', () => {
  it('points at the title page for that id', () => {
    expect(imdbTitleUrl('tt8299938')).toBe('https://www.imdb.com/title/tt8299938');
  });
});

describe('mediaSameAsUrls', () => {
  it('includes every catalog we can spell a URL for', () => {
    expect(
      mediaSameAsUrls({
        airingFormat: 'TV',
        externalIds: { anilist: '100077', imdb: 'tt8299938', tmdb: '233452', youtube: 'UCabc' },
      }),
    ).toEqual([
      'https://anilist.co/anime/100077',
      'https://www.imdb.com/title/tt8299938',
      'https://www.themoviedb.org/tv/233452',
      'https://www.youtube.com/channel/UCabc',
    ]);
  });

  it('skips TMDB when the format is unknown, rather than guessing the path', () => {
    expect(mediaSameAsUrls({ externalIds: { tmdb: '233452' } })).toEqual([]);
  });

  it('skips missing and empty ids', () => {
    expect(mediaSameAsUrls({ externalIds: { anilist: '', imdb: null, youtube: undefined } })).toEqual([]);
    expect(mediaSameAsUrls(null)).toEqual([]);
  });
});

/**
 * The parts of this module that touch the network, the clipboard and the DOM,
 * which were the untested half.
 *
 * `fetchAudioSegment` and `downloadAudioOrImage` share one hazard worth being
 * explicit about: a clip the reader has just PLAYED is already in the browser's
 * cache as a non-CORS entry, and re-requesting it reuses that entry and rejects
 * as a bare `Failed to fetch`. So both retry past the cache, and the retry is
 * exactly what makes the buttons work on the segments a reader is most likely to
 * press them on.
 */
describe('fetchAudioSegment', () => {
  function stubFetch(...outcomes: (Response | Error)[]) {
    const fetchMock = vi.fn();
    for (const outcome of outcomes) {
      if (outcome instanceof Error) fetchMock.mockRejectedValueOnce(outcome);
      else fetchMock.mockResolvedValueOnce(outcome);
    }
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('returns the response, without a retry, when the first request works', async () => {
    const fetchMock = stubFetch(new Response('audio', { status: 200 }));

    const { cacheBypassed } = await fetchAudioSegment(AUDIO_URL);

    expect(cacheBypassed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries past the cache when the first request rejects opaquely', async () => {
    const fetchMock = stubFetch(new TypeError('Failed to fetch'), new Response('audio', { status: 200 }));

    const { cacheBypassed } = await fetchAudioSegment(AUDIO_URL);

    expect(cacheBypassed).toBe(true);
    expect(fetchMock.mock.calls[1]![1]).toEqual({ cache: 'reload' });
  });

  it('does not retry a real HTTP status, which retrying cannot change', async () => {
    // A status is an answer from the CDN. Re-asking past the cache costs a
    // second request to be told the same thing.
    const fetchMock = stubFetch(new Response('missing', { status: 404 }));

    await expect(fetchAudioSegment(AUDIO_URL)).rejects.toMatchObject({ status: 404, kind: 'http' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports the status when the retry itself comes back with one', async () => {
    stubFetch(new TypeError('Failed to fetch'), new Response('boom', { status: 503 }));

    await expect(fetchAudioSegment(AUDIO_URL)).rejects.toMatchObject({ status: 503, kind: 'http' });
  });

  it('keeps the ORIGINAL rejection as the cause when both attempts fail opaquely', async () => {
    // The retry failing the same way says nothing new; the first failure is the
    // one `describeAudioFetchFailure` has something to say about.
    const first = new TypeError('Failed to fetch');
    stubFetch(first, new TypeError('Failed to fetch again'));

    await expect(fetchAudioSegment(AUDIO_URL)).rejects.toMatchObject({ kind: 'opaque', cause: first });
  });
});

describe('youtube and channel links', () => {
  it('starts the video at the segment, in whole seconds', () => {
    expect(youtubeWatchUrl('vid-1', 61_500)).toBe('https://www.youtube.com/watch?v=vid-1&t=61');
  });

  it('never emits a negative start, which YouTube ignores', () => {
    expect(youtubeWatchUrl('vid-1', -5_000)).toBe('https://www.youtube.com/watch?v=vid-1&t=0');
  });

  it('links a channel by id', () => {
    expect(youtubeChannelUrl('UC123')).toBe('https://www.youtube.com/channel/UC123');
  });
});

describe('copyToClipboard', () => {
  const toastSuccess = vi.fn();
  const toastError = vi.fn();

  function stubClipboard(writeText: () => Promise<void>) {
    toastSuccess.mockClear();
    toastError.mockClear();
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(writeText) } });
    vi.stubGlobal('useNuxtApp', () => ({ $i18n: { t: (key: string) => key } }));
    vi.stubGlobal('useToastSuccess', toastSuccess);
    vi.stubGlobal('useToastError', toastError);
    vi.stubGlobal('document', {
      createElement: () => {
        const el = { innerHTML: '', textContent: '', innerText: '' };
        return new Proxy(el, {
          set(target, prop, value) {
            if (prop === 'innerHTML') {
              target.innerHTML = value;
              // Enough of a parser for what this copies: the highlight markup a
              // search result carries.
              target.textContent = String(value).replace(/<[^>]*>/g, '');
            }
            return true;
          },
        });
      },
    });
  }

  it('copies the text with its highlight markup stripped', async () => {
    // The reader asked for the sentence, not for the `<em>` the search put
    // around the word they matched on.
    stubClipboard(async () => {});

    expect(await copyToClipboard('<em>食べ</em>たい')).toBe(true);
    expect((navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe('食べたい');
  });

  it('confirms the copy', async () => {
    stubClipboard(async () => {});

    await copyToClipboard('text');

    expect(toastSuccess).toHaveBeenCalled();
  });

  it('reports a refusal rather than letting the button read as having worked', async () => {
    // A denied permission, or a non-secure origin, rejects here.
    stubClipboard(async () => {
      throw new Error('NotAllowedError');
    });

    expect(await copyToClipboard('text')).toBe(false);
    expect(toastError).toHaveBeenCalled();
  });
});

/**
 * Concatenating several clips into one WAV, which is what an expanded sentence
 * plays and what an Anki card gets attached.
 *
 * The WAV header is written by hand, byte by byte, and that is the whole reason
 * this is worth testing: a wrong field length or a wrong byte order produces a
 * file that some players open and others refuse, so a break here shows up as
 * "the audio does not work in Anki" long after the change that caused it. The
 * numbers below are from the canonical WAVE spec the source links to.
 */
describe('concatenateAudios', () => {
  /** A decoded buffer of `length` frames, each channel filled with `fill`. */
  function audioBuffer(length: number, channels = 2, sampleRate = 44_100, fill = 0) {
    const data = Array.from({ length: channels }, () => new Float32Array(length).fill(fill));
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: (channel: number) => data[channel] ?? new Float32Array(length),
    };
  }

  /**
   * An AudioContext double that decodes to the buffers it is given, in order.
   *
   * The module keeps ONE context for the life of the page -- building one per
   * expansion is expensive and browsers cap how many a tab may have -- so each
   * case re-imports the module to get a fresh one. Without that the second test
   * would reuse the first's decoder and read past the end of its list.
   */
  function stubAudioContext(buffers: ReturnType<typeof audioBuffer>[]) {
    let next = 0;
    vi.stubGlobal(
      'AudioContext',
      class {
        decodeAudioData = vi.fn(async () => buffers[next++]);
        createBuffer = (channels: number, length: number, sampleRate: number) =>
          audioBuffer(length, channels, sampleRate);
        close = vi.fn();
      },
    );
  }

  /** A `concatenateAudios` bound to a freshly created audio context. */
  async function freshConcatenateAudios() {
    vi.resetModules();
    return (await import('~/utils/media')).concatenateAudios;
  }

  /** Answers every fetch with a body the stubbed decoder will be handed. */
  function stubFetchOk() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([0, 0, 0, 0]), { status: 200 })),
    );
  }

  /** Captures the blob handed to `createObjectURL`, which is the WAV. */
  function captureBlob() {
    const captured: Blob[] = [];
    vi.stubGlobal('window', {
      URL: {
        createObjectURL: (blob: Blob) => {
          captured.push(blob);
          return 'blob:built';
        },
        revokeObjectURL: vi.fn(),
      },
    });
    return captured;
  }

  /** The WAV header fields, read back the way a player would. */
  async function readHeader(blob: Blob) {
    const view = new DataView(await blob.arrayBuffer());
    const ascii = (offset: number) =>
      String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3),
      );
    return {
      riff: ascii(0),
      chunkSize: view.getUint32(4, true),
      wave: ascii(8),
      fmt: ascii(12),
      subchunk1Size: view.getUint32(16, true),
      audioFormat: view.getUint16(20, true),
      channels: view.getUint16(22, true),
      sampleRate: view.getUint32(24, true),
      byteRate: view.getUint32(28, true),
      blockAlign: view.getUint16(32, true),
      bitsPerSample: view.getUint16(34, true),
      data: ascii(36),
      subchunk2Size: view.getUint32(40, true),
      byteLength: view.byteLength,
    };
  }

  it('builds one blob from several clips', async () => {
    const concatenate = await freshConcatenateAudios();
    stubFetchOk();
    stubAudioContext([audioBuffer(100), audioBuffer(50)]);
    const blobs = captureBlob();

    const result = await concatenate(['a.mp3', 'b.mp3']);

    expect(result.blob_url).toBe('blob:built');
    expect(blobs).toHaveLength(1);
  });

  it('writes a header a player will accept', async () => {
    const concatenate = await freshConcatenateAudios();
    stubFetchOk();
    stubAudioContext([audioBuffer(100, 2, 44_100)]);
    const blobs = captureBlob();

    await concatenate(['a.mp3']);
    const header = await readHeader(blobs[0]!);

    expect(header).toMatchObject({
      riff: 'RIFF',
      wave: 'WAVE',
      fmt: 'fmt ',
      data: 'data',
      subchunk1Size: 16,
      // 1 is PCM. Anything else says the samples are compressed, which they
      // are not, and a player would try to decode them as something they aren't.
      audioFormat: 1,
      bitsPerSample: 16,
    });
  });

  it('carries the source’s own channel count and sample rate', async () => {
    const concatenate = await freshConcatenateAudios();
    // Writing a fixed 44.1k header over a 48k clip plays it back at the wrong
    // speed and pitch -- audible, and easy to mistake for a bad recording.
    stubFetchOk();
    stubAudioContext([audioBuffer(100, 2, 48_000)]);
    const blobs = captureBlob();

    await concatenate(['a.mp3']);

    expect(await readHeader(blobs[0]!)).toMatchObject({ channels: 2, sampleRate: 48_000 });
  });

  it('derives the byte rate and block alignment from those, rather than assuming', async () => {
    const concatenate = await freshConcatenateAudios();
    stubFetchOk();
    stubAudioContext([audioBuffer(100, 2, 48_000)]);
    const blobs = captureBlob();

    await concatenate(['a.mp3']);
    const header = await readHeader(blobs[0]!);

    // 16-bit stereo: 4 bytes per frame, and a second is `sampleRate` frames.
    expect(header.blockAlign).toBe(4);
    expect(header.byteRate).toBe(48_000 * 4);
  });

  it('declares the sizes the header promises, so the file is not truncated or over-read', async () => {
    const concatenate = await freshConcatenateAudios();
    // `chunkSize` is 36 + the data, and `subchunk2Size` is the data alone. A
    // player that trusts either one and finds fewer bytes cuts the clip short.
    stubFetchOk();
    stubAudioContext([audioBuffer(100, 2, 44_100), audioBuffer(50, 2, 44_100)]);
    const blobs = captureBlob();

    await concatenate(['a.mp3', 'b.mp3']);
    const header = await readHeader(blobs[0]!);

    const samples = (100 + 50) * 2;
    expect(header.subchunk2Size).toBe(samples * 2);
    expect(header.chunkSize).toBe(36 + samples * 2);
    expect(header.byteLength).toBe(44 + samples * 2);
  });

  it('lengthens the clip by every part it was given', async () => {
    const concatenate = await freshConcatenateAudios();
    stubFetchOk();
    stubAudioContext([audioBuffer(100), audioBuffer(50), audioBuffer(25)]);
    const blobs = captureBlob();

    await concatenate(['a.mp3', 'b.mp3', 'c.mp3']);

    expect((await readHeader(blobs[0]!)).subchunk2Size).toBe((100 + 50 + 25) * 2 * 2);
  });

  it('fetches the parts concurrently rather than one after another', async () => {
    const concatenate = await freshConcatenateAudios();
    // Three round trips in series is three times the wait before any of the
    // expansion is audible.
    const order: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        order.push(`start:${url}`);
        await Promise.resolve();
        return new Response(new Uint8Array([0]), { status: 200 });
      }),
    );
    stubAudioContext([audioBuffer(10), audioBuffer(10)]);
    captureBlob();

    await concatenate(['a.mp3', 'b.mp3']);

    expect(order).toEqual(['start:a.mp3', 'start:b.mp3']);
  });

  it('reports that the cache had to be bypassed, so the diagnosis carries it', async () => {
    const concatenate = await freshConcatenateAudios();
    // A clip the reader had just played is in the browser's cache as a non-CORS
    // entry; whether the retry was needed is what says so.
    const fetchMock = vi.fn();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetchMock.mockResolvedValue(new Response(new Uint8Array([0]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    stubAudioContext([audioBuffer(10)]);
    captureBlob();

    expect((await concatenate(['a.mp3'])).cacheBypassed).toBe(true);
  });

  it('fails the whole build when any one part could not be fetched', async () => {
    const concatenate = await freshConcatenateAudios();
    // A concatenation missing its middle is worse than one that did not
    // happen: the text says three sentences and the audio plays two.
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([0]), { status: 200 }));
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    stubAudioContext([audioBuffer(10)]);
    captureBlob();

    await expect(concatenate(['a.mp3', 'b.mp3'])).rejects.toThrow();
  });

  it('refuses an empty list rather than emitting a headers-only file', async () => {
    const concatenate = await freshConcatenateAudios();
    stubFetchOk();
    stubAudioContext([]);
    captureBlob();

    await expect(concatenate([])).rejects.toThrow(/No audio buffers/);
  });
});
