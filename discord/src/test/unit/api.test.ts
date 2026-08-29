import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * `api.ts` is the one place the bot decides what it actually asks the backend
 * for. Every option a user picks in a slash command or a modal ends up here as
 * a field of a search body, and a field that silently stops being sent looks
 * exactly like a search that returns the wrong thing -- there is no error, no
 * log line, just different results. So the request body is asserted directly.
 *
 * The SDK client is replaced but `NadeshikoError` is kept real: `callApi`
 * branches on `instanceof`, and a stubbed class would take the wrong branch
 * while still passing a shallower assertion.
 */
const sdkStub = {
  search: vi.fn(),
  getSegment: vi.fn(),
  getSegmentContext: vi.fn(),
  listMedia: vi.fn(),
  searchMedia: vi.fn(),
  getStatsOverview: vi.fn(),
  getSearchStats: vi.fn(),
  client: {
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
};

vi.mock('@brigadasos/nadeshiko-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@brigadasos/nadeshiko-sdk')>()),
  createNadeshikoClient: () => sdkStub,
}));

vi.mock('../../config', () => ({
  BOT_CONFIG: {
    apiKey: 'test-key',
    apiBaseUrl: 'http://api.test',
    maxSearchResults: 20,
  },
}));

import { NadeshikoError } from '@brigadasos/nadeshiko-sdk';
import {
  initSdk,
  parseSortMode,
  parseCategory,
  search,
  fetchRandom,
  getSegment,
  getSegmentContext,
  listMedia,
  searchMedia,
  getStats,
  getSearchStats,
  downloadFile,
} from '../../api';
import { makeSegment, makeMedia } from '../mocks/fixtures';

/** The shape `search()` returns before it normalizes `includes`. */
function sdkSearchResult(overrides: Record<string, unknown> = {}) {
  return {
    segments: [],
    pagination: { hasMore: false, estimatedTotalHits: 0, estimatedTotalHitsRelation: 'EXACT', cursor: '' },
    ...overrides,
  };
}

/** The body the last `sdk.search` call was made with. */
function lastSearchBody() {
  return sdkStub.search.mock.calls.at(-1)?.[0];
}

beforeEach(() => {
  for (const fn of Object.values(sdkStub)) {
    if (typeof fn === 'function' && 'mockReset' in fn) fn.mockReset();
  }
  sdkStub.client.interceptors.request.use.mockReset();
  sdkStub.client.interceptors.response.use.mockReset();
  sdkStub.search.mockResolvedValue(sdkSearchResult());
  initSdk();
});

describe('parseSortMode', () => {
  test.each(['RELEVANCE', 'ASC', 'DESC', 'TIME_ASC', 'TIME_DESC', 'RANDOM'])('accepts %s', (mode) => {
    expect(parseSortMode(mode)).toBe(mode);
  });

  test('is case- and whitespace-insensitive, because the value arrives from user input', () => {
    expect(parseSortMode('  random  ')).toBe('RANDOM');
  });

  test.each([['SIDEWAYS'], [''], [null], [undefined]])('rejects %s rather than passing it to the API', (input) => {
    expect(parseSortMode(input)).toBeUndefined();
  });

  test('does not treat inherited Object properties as sort modes', () => {
    // `candidate in SORT_MODES` walks the prototype chain, so `toString` and
    // `constructor` are `in` the record without being sort modes. Sent to the
    // API they are a 400 the user sees as "something went wrong".
    expect(parseSortMode('constructor')).toBeUndefined();
    expect(parseSortMode('toString')).toBeUndefined();
  });
});

describe('parseCategory', () => {
  test.each(['ANIME', 'JDRAMA', 'YOUTUBE'])('accepts %s', (category) => {
    expect(parseCategory(category)).toBe(category);
  });

  test('normalizes case', () => {
    expect(parseCategory('anime')).toBe('ANIME');
  });

  test.each([['MOVIE'], [''], [null], [undefined]])('rejects %s', (input) => {
    expect(parseCategory(input)).toBeUndefined();
  });

  test('does not treat inherited Object properties as categories', () => {
    expect(parseCategory('valueOf')).toBeUndefined();
  });
});

describe('search request body', () => {
  test('only ACTIVE segments are ever asked for', async () => {
    // Non-ACTIVE segments are hidden or under review. The bot posts publicly
    // into servers, so this filter is the difference between a normal reply and
    // one nobody approved.
    await search('食べる');

    expect(lastSearchBody().filters.status).toEqual(['ACTIVE']);
  });

  test('a query is sent with its exactMatch flag', async () => {
    await search('食べる', { exactMatch: true });

    expect(lastSearchBody().query).toEqual({ search: '食べる', exactMatch: true });
  });

  test('an empty query is sent as undefined, not as an empty search string', async () => {
    // `/random` searches with no query at all. An empty string is a *query* to
    // the backend and scores every segment against it; undefined is "no query",
    // which is what makes a random draw random.
    await search('');

    expect(lastSearchBody().query).toBeUndefined();
  });

  test('take falls back to the configured maximum', async () => {
    await search('x');

    expect(lastSearchBody().take).toBe(20);
  });

  test('an explicit take wins over the configured maximum', async () => {
    await search('x', { take: 3 });

    expect(lastSearchBody().take).toBe(3);
  });

  test('a media filter is sent as an include entry', async () => {
    await search('x', { mediaPublicId: 'media-7' });

    expect(lastSearchBody().filters.media).toEqual({ include: [{ mediaPublicId: 'media-7' }] });
  });

  test('episodes ride along with the media they belong to', async () => {
    await search('x', { mediaPublicId: 'media-7', episodes: [2, 3] });

    expect(lastSearchBody().filters.media).toEqual({ include: [{ mediaPublicId: 'media-7', episodes: [2, 3] }] });
  });

  test('episodes without a media id are dropped, since the API cannot scope them', async () => {
    await search('x', { episodes: [2, 3] });

    expect(lastSearchBody().filters.media).toBeUndefined();
  });

  test('a length filter is sent when either bound is given', async () => {
    await search('x', { lengthMin: 10 });

    expect(lastSearchBody().filters.segmentLengthChars).toEqual({ min: 10, max: undefined });
  });

  test('both length bounds travel together', async () => {
    await search('x', { lengthMin: 10, lengthMax: 40 });

    expect(lastSearchBody().filters.segmentLengthChars).toEqual({ min: 10, max: 40 });
  });

  test('no length filter is sent when neither bound is set', async () => {
    await search('x');

    expect(lastSearchBody().filters.segmentLengthChars).toBeUndefined();
  });

  test('sort carries its seed, which is what makes a RANDOM page paginate consistently', async () => {
    await search('x', { sort: 'RANDOM', seed: 42 });

    expect(lastSearchBody().sort).toEqual({ mode: 'RANDOM', seed: 42 });
  });

  test('no sort key is sent when the user did not choose one', async () => {
    await search('x');

    expect(lastSearchBody().sort).toBeUndefined();
  });

  test('media is always included, because the reply renders a media name', async () => {
    await search('x');

    expect(lastSearchBody().include).toEqual(['media']);
  });

  test('a category narrows the filter', async () => {
    await search('x', { category: 'JDRAMA' });

    expect(lastSearchBody().filters.category).toEqual(['JDRAMA']);
  });

  test('the cursor is forwarded so the next page continues the same result set', async () => {
    await search('x', { cursor: 'cur-2' });

    expect(lastSearchBody().cursor).toBe('cur-2');
  });
});

describe('search response normalization', () => {
  test('a response with no includes still exposes an empty media map', async () => {
    // Callers index `includes.media[segment.mediaPublicId]` unguarded. Without
    // this default the bot throws on any response the backend returned without
    // includes, which is what an empty result set looks like.
    sdkStub.search.mockResolvedValue(sdkSearchResult({ segments: [makeSegment()] }));

    const response = await search('x');

    expect(response.includes.media).toEqual({});
  });

  test('media that the backend did send is preserved', async () => {
    const media = makeMedia({ publicId: 'media-1' });
    sdkStub.search.mockResolvedValue(sdkSearchResult({ includes: { media: { 'media-1': media } } }));

    const response = await search('x');

    expect(response.includes.media['media-1']).toEqual(media);
  });
});

describe('fetchRandom', () => {
  test('draws a single segment with a seeded RANDOM sort', async () => {
    await fetchRandom();

    const body = lastSearchBody();
    expect(body.take).toBe(1);
    expect(body.sort.mode).toBe('RANDOM');
    expect(body.query).toBeUndefined();
  });

  test('a fresh seed is drawn per call, so two /random calls differ', async () => {
    // A fixed seed would make /random return the same sentence forever -- the
    // failure is invisible in a single test run and obvious to users.
    const seeds = new Set<number>();
    for (let i = 0; i < 20; i++) {
      await fetchRandom();
      seeds.add(lastSearchBody().sort.seed);
    }

    expect(seeds.size).toBeGreaterThan(1);
  });

  test('narrows to a media and its episodes when asked', async () => {
    await fetchRandom('media-3', [7]);

    expect(lastSearchBody().filters.media).toEqual({ include: [{ mediaPublicId: 'media-3', episodes: [7] }] });
  });
});

describe('getSegmentContext', () => {
  test('asks for the requested window around the segment', async () => {
    sdkStub.getSegmentContext.mockResolvedValue({ segments: [] });

    await getSegmentContext('seg-1', 3);

    expect(sdkStub.getSegmentContext).toHaveBeenCalledWith({ segmentPublicId: 'seg-1', take: 3, include: ['media'] });
  });

  test('defaults to five surrounding segments', async () => {
    sdkStub.getSegmentContext.mockResolvedValue({ segments: [] });

    await getSegmentContext('seg-1');

    expect(sdkStub.getSegmentContext.mock.calls[0][0].take).toBe(5);
  });

  test('normalizes a missing includes block to an empty media map', async () => {
    sdkStub.getSegmentContext.mockResolvedValue({ segments: [makeSegment()] });

    expect((await getSegmentContext('seg-1')).includes.media).toEqual({});
  });
});

describe('getSegment', () => {
  test('pairs the segment with the media the context call resolved', async () => {
    const segment = makeSegment({ publicId: 'seg-1', mediaPublicId: 'media-1' });
    const media = makeMedia({ publicId: 'media-1' });
    sdkStub.getSegment.mockResolvedValue(segment);
    sdkStub.getSegmentContext.mockResolvedValue({ segments: [], includes: { media: { 'media-1': media } } });

    expect(await getSegment('seg-1')).toEqual({ segment, media });
  });

  test('returns a null media rather than throwing when the context has none', async () => {
    // A segment whose media was deleted still has text worth showing. `null`
    // lets the reply degrade to "unknown media"; an undefined lookup crashing
    // here would take the whole command down.
    sdkStub.getSegment.mockResolvedValue(makeSegment({ mediaPublicId: 'media-gone' }));
    sdkStub.getSegmentContext.mockResolvedValue({ segments: [] });

    expect((await getSegment('seg-1')).media).toBeNull();
  });

  test('asks for one context segment only -- it is fetched for the media, not the text', async () => {
    sdkStub.getSegment.mockResolvedValue(makeSegment());
    sdkStub.getSegmentContext.mockResolvedValue({ segments: [] });

    await getSegment('seg-1');

    expect(sdkStub.getSegmentContext.mock.calls[0][0].take).toBe(1);
  });
});

describe('listMedia and searchMedia', () => {
  test('listMedia forwards its page size and cursor', async () => {
    sdkStub.listMedia.mockResolvedValue({ media: [], pagination: { hasMore: false } });

    await listMedia(5, 'cur-1');

    expect(sdkStub.listMedia).toHaveBeenCalledWith({ take: 5, cursor: 'cur-1' });
  });

  test('searchMedia defaults to ten results, the autocomplete budget', async () => {
    sdkStub.searchMedia.mockResolvedValue({ media: [] });

    await searchMedia('oshi');

    expect(sdkStub.searchMedia).toHaveBeenCalledWith({ query: 'oshi', take: 10 });
  });
});

describe('getSearchStats', () => {
  test('an empty query is sent as undefined rather than an empty search', async () => {
    sdkStub.getSearchStats.mockResolvedValue({ media: [], categories: [] });

    await getSearchStats('');

    expect(sdkStub.getSearchStats.mock.calls[0][0].query).toBeUndefined();
  });

  test('a category becomes a filter, and no category means no filters at all', async () => {
    sdkStub.getSearchStats.mockResolvedValue({ media: [], categories: [] });

    await getSearchStats('x', { category: 'ANIME' });
    expect(sdkStub.getSearchStats.mock.calls[0][0].filters).toEqual({ category: ['ANIME'] });

    await getSearchStats('x');
    expect(sdkStub.getSearchStats.mock.calls[1][0].filters).toBeUndefined();
  });

  test('normalizes a missing includes block', async () => {
    sdkStub.getSearchStats.mockResolvedValue({ media: [], categories: [] });

    expect((await getSearchStats('x')).includes.media).toEqual({});
  });
});

describe('getStats', () => {
  test('returns the overview unchanged', async () => {
    const stats = { totalSegments: 1, totalMedia: 2 };
    sdkStub.getStatsOverview.mockResolvedValue(stats);

    expect(await getStats()).toBe(stats);
  });
});

describe('error propagation', () => {
  test('a NadeshikoError reaches the caller, so the command can show its trace id', async () => {
    // `callApi` logs the structured detail and rethrows. Swallowing it here
    // would leave the command replying with a success it never got.
    const apiError = new NadeshikoError({
      code: 'INTERNAL_ERROR',
      title: 'Boom',
      detail: 'boom',
      status: 500,
      instance: 'trace-1',
    } as never);
    sdkStub.search.mockRejectedValue(apiError);

    await expect(search('x')).rejects.toBe(apiError);
  });

  test('a non-API failure (a dropped connection) also propagates', async () => {
    const networkError = new Error('ECONNREFUSED');
    sdkStub.getStatsOverview.mockRejectedValue(networkError);

    await expect(getStats()).rejects.toBe(networkError);
  });
});

describe('downloadFile', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns the bytes on success', async () => {
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as typeof fetch;

    const buffer = await downloadFile('http://cdn.test/a.mp4');

    expect(buffer).toEqual(Buffer.from([1, 2, 3]));
  });

  test('returns null on a non-OK response instead of an empty buffer', async () => {
    // The caller treats null as "post the reply without the clip". An empty
    // Buffer would be attached and render as a broken video.
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 404 })) as typeof fetch;

    expect(await downloadFile('http://cdn.test/missing.mp4')).toBeNull();
  });
});

describe('initSdk', () => {
  test('registers request and response interceptors for logging', async () => {
    expect(sdkStub.client.interceptors.request.use).toHaveBeenCalledTimes(1);
    expect(sdkStub.client.interceptors.response.use).toHaveBeenCalledTimes(1);
  });

  test('the response interceptor passes the response through untouched', async () => {
    const interceptor = sdkStub.client.interceptors.response.use.mock.calls[0][0];
    const ok = { ok: true, url: 'http://api.test/x', status: 200 };
    const failed = { ok: false, url: 'http://api.test/x', status: 500 };

    expect(interceptor(ok)).toBe(ok);
    expect(interceptor(failed)).toBe(failed);
  });

  test('the request interceptor passes the request through untouched', async () => {
    const interceptor = sdkStub.client.interceptors.request.use.mock.calls[0][0];
    const request = { method: 'POST', url: 'http://api.test/x' };

    expect(interceptor(request)).toBe(request);
  });
});
