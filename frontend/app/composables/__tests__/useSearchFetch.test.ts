import { describe, it, expect, vi, beforeEach } from 'vitest';

const sdkMocks = vi.hoisted(() => ({
  search: vi.fn(),
  getSearchStats: vi.fn(),
  searchCollectionSegments: vi.fn(),
  getCollectionStats: vi.fn(),
  getSegment: vi.fn(),
  getMedia: vi.fn(),
}));

vi.mock('@brigadasos/nadeshiko-sdk', () => sdkMocks);

import { deferred } from './deferred';
import {
  COLLECTION_PAGE_SIZE,
  SEARCH_PAGE_SIZE,
  buildSentenceFilters,
  buildStatsFilters,
  createRequestSequencer,
  createSearchFetcher,
  type SearchScope,
} from '../useSearchFetch';

const fakeSdk = { client: { id: 'test-client' } } as never;

const scope = (overrides: Partial<SearchScope> = {}): SearchScope => ({
  query: 'ねこ',
  category: 'all',
  mediaPublicId: null,
  episode: null,
  sort: null,
  segmentPublicId: null,
  collectionId: null,
  listMediaIds: null,
  contentRating: ['SAFE'],
  languages: undefined,
  hiddenMediaExclude: [],
  ...overrides,
});

const searchPayload = (id: string) => ({
  segments: [{ publicId: id, mediaPublicId: 'media-1' }],
  includes: { media: {} },
  pagination: { hasMore: false, cursor: '', estimatedTotalHits: 1, estimatedTotalHitsRelation: 'EXACT' },
});

beforeEach(() => {
  for (const mock of Object.values(sdkMocks)) {
    mock.mockReset();
  }
});

describe('createRequestSequencer', () => {
  it('invalidates and aborts the previous generation when a new one starts', () => {
    const sequencer = createRequestSequencer();

    const first = sequencer.start();
    expect(sequencer.isCurrent(first)).toBe(true);

    const second = sequencer.start();
    expect(first.signal.aborted).toBe(true);
    expect(sequencer.isCurrent(first)).toBe(false);
    expect(sequencer.isCurrent(second)).toBe(true);
  });

  it('cancel() aborts the in-flight generation without opening a new one', () => {
    const sequencer = createRequestSequencer();

    const generation = sequencer.start();
    sequencer.cancel();

    expect(generation.signal.aborted).toBe(true);
    expect(sequencer.isCurrent(generation)).toBe(false);
  });
});

describe('search filters', () => {
  it('keeps hidden media out of the result list only when no media is explicitly requested', () => {
    const hidden = [{ mediaPublicId: 'hidden-1' }];

    expect(buildSentenceFilters(scope({ hiddenMediaExclude: hidden })).media?.exclude).toEqual(hidden);
    expect(
      buildSentenceFilters(scope({ hiddenMediaExclude: hidden, mediaPublicId: 'hidden-1' })).media?.exclude,
    ).toBeUndefined();
  });

  it('keeps hidden media out of the tab counts even when a media is requested', () => {
    const hidden = [{ mediaPublicId: 'hidden-1' }];
    const filters = buildStatsFilters(scope({ hiddenMediaExclude: hidden, mediaPublicId: 'hidden-1' }));

    expect(filters.media?.exclude).toEqual(hidden);
    expect(filters.media?.include).toBeUndefined();
  });

  it('restricts the result list to the requested media and episode', () => {
    const filters = buildSentenceFilters(scope({ mediaPublicId: 'media-1', episode: 3 }));
    expect(filters.media?.include).toEqual([{ mediaPublicId: 'media-1', episodes: [3] }]);
  });
});

describe('fetchSentences', () => {
  it('reports the superseded request as stale and lets the newer one win', async () => {
    const slow = deferred<unknown>();
    const fast = deferred<unknown>();
    sdkMocks.search.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

    const fetcher = createSearchFetcher(fakeSdk);
    const first = fetcher.fetchSentences(scope({ query: 'old' }));
    const second = fetcher.fetchSentences(scope({ query: 'new' }));

    // The newer request settles first, then the stale one comes back with data.
    fast.resolve({ data: searchPayload('new-segment'), response: new Response() });
    slow.resolve({ data: searchPayload('old-segment'), response: new Response() });

    expect(await second).toEqual({
      status: 'ok',
      data: expect.objectContaining({
        results: [expect.objectContaining({ segment: { publicId: 'new-segment', mediaPublicId: 'media-1' } })],
      }),
    });
    expect(await first).toEqual({ status: 'stale' });
  });

  it('aborts the in-flight request when a newer one starts', async () => {
    const slow = deferred<unknown>();
    sdkMocks.search.mockReturnValueOnce(slow.promise).mockResolvedValueOnce({
      data: searchPayload('new-segment'),
      response: new Response(),
    });

    const fetcher = createSearchFetcher(fakeSdk);
    const first = fetcher.fetchSentences(scope());
    await fetcher.fetchSentences(scope({ query: 'other' }));

    expect(sdkMocks.search.mock.calls[0]?.[0].signal.aborted).toBe(true);

    slow.resolve({ data: searchPayload('old-segment'), response: new Response() });
    expect(await first).toEqual({ status: 'stale' });
  });

  it('reports a rejected superseded request as stale rather than an error', async () => {
    const slow = deferred<unknown>();
    sdkMocks.search
      .mockReturnValueOnce(slow.promise.then(() => Promise.reject(new Error('aborted'))))
      .mockResolvedValueOnce({ data: searchPayload('new-segment'), response: new Response() });

    const fetcher = createSearchFetcher(fakeSdk);
    const first = fetcher.fetchSentences(scope());
    await fetcher.fetchSentences(scope({ query: 'other' }));

    slow.resolve(undefined);
    expect(await first).toEqual({ status: 'stale' });
  });

  it('cancelSentences() makes an in-flight request stale', async () => {
    const slow = deferred<unknown>();
    sdkMocks.search.mockReturnValueOnce(slow.promise);

    const fetcher = createSearchFetcher(fakeSdk);
    const pending = fetcher.fetchSentences(scope());
    fetcher.cancelSentences();

    slow.resolve({ data: searchPayload('old-segment'), response: new Response() });
    expect(await pending).toEqual({ status: 'stale' });
  });

  it('requests a full corpus page and passes the cursor through', async () => {
    sdkMocks.search.mockResolvedValue({ data: searchPayload('a'), response: new Response() });

    const fetcher = createSearchFetcher(fakeSdk);
    await fetcher.fetchSentences(scope(), { cursor: 'cursor-2' });

    expect(sdkMocks.search.mock.calls[0]?.[0].body).toMatchObject({
      take: SEARCH_PAGE_SIZE,
      cursor: 'cursor-2',
      include: ['media'],
      query: { search: 'ねこ' },
    });
  });

  it('requests collection pages with the collection page size and media includes', async () => {
    sdkMocks.searchCollectionSegments.mockResolvedValue({ data: searchPayload('a'), response: new Response() });

    const fetcher = createSearchFetcher(fakeSdk);
    await fetcher.fetchSentences(scope({ collectionId: 'col-1' }), { cursor: 'cursor-2' });

    const call = sdkMocks.searchCollectionSegments.mock.calls[0]?.[0];
    expect(call.path).toEqual({ collectionPublicId: 'col-1' });
    expect(call.body).toEqual({ take: COLLECTION_PAGE_SIZE, include: ['media'], cursor: 'cursor-2' });
  });

  it('distinguishes a forbidden collection from a failed one', async () => {
    const fetcher = createSearchFetcher(fakeSdk);

    sdkMocks.searchCollectionSegments.mockResolvedValueOnce({
      error: {},
      response: new Response(null, { status: 403 }),
    });
    expect(await fetcher.fetchSentences(scope({ collectionId: 'col-1' }))).toEqual({ status: 'forbidden' });

    sdkMocks.searchCollectionSegments.mockResolvedValueOnce({
      error: {},
      response: new Response(null, { status: 500 }),
    });
    expect(await fetcher.fetchSentences(scope({ collectionId: 'col-1' }))).toEqual({ status: 'error' });
  });

  it('reports a failed search as an error instead of an empty result set', async () => {
    sdkMocks.search.mockResolvedValue({ error: {}, response: new Response(null, { status: 503 }) });

    const fetcher = createSearchFetcher(fakeSdk);
    expect(await fetcher.fetchSentences(scope())).toEqual({ status: 'error' });
  });
});

describe('fetchStats', () => {
  it('runs on its own sequence, independent of the result list', async () => {
    const slowStats = deferred<unknown>();
    sdkMocks.getSearchStats.mockReturnValueOnce(slowStats.promise);
    sdkMocks.search.mockResolvedValue({ data: searchPayload('a'), response: new Response() });

    const fetcher = createSearchFetcher(fakeSdk);
    const stats = fetcher.fetchStats(scope());
    await fetcher.fetchSentences(scope({ query: 'other' }));

    slowStats.resolve({ data: { media: [], categories: [] }, response: new Response() });
    expect(await stats).toEqual({ status: 'ok', data: { media: [], categories: [] } });
  });

  it('marks the superseded stats request as stale', async () => {
    const slow = deferred<unknown>();
    sdkMocks.getSearchStats
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce({ data: { media: [], categories: [] }, response: new Response() });

    const fetcher = createSearchFetcher(fakeSdk);
    const first = fetcher.fetchStats(scope());
    await fetcher.fetchStats(scope({ query: 'other' }));

    slow.resolve({ data: { media: [], categories: [] }, response: new Response() });
    expect(await first).toEqual({ status: 'stale' });
  });
});
