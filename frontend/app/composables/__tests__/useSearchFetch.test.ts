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

const reportErrorMock = vi.hoisted(() => vi.fn());
const reportEventMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/reportError', () => ({ reportError: reportErrorMock, reportEvent: reportEventMock }));

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
  randomSeed: null,
  segmentPublicId: null,
  collectionId: null,
  listMediaIds: null,
  contentRating: ['SAFE'],
  languages: undefined,
  hiddenMediaExclude: [],
  hiddenCategories: [],
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
  reportErrorMock.mockReset();
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

describe('search filters with hidden categories', () => {
  it('narrows an unfiltered search to the categories left visible', () => {
    const filters = buildSentenceFilters(scope({ hiddenCategories: ['JDRAMA'] }));
    expect(filters.category).toEqual(['ANIME', 'YOUTUBE']);
  });

  it('applies the same narrowing to the tab counts', () => {
    const filters = buildStatsFilters(scope({ hiddenCategories: ['JDRAMA', 'YOUTUBE'] }));
    expect(filters.category).toEqual(['ANIME']);
  });

  it('lets an explicitly requested category through even when it is hidden', () => {
    const filters = buildSentenceFilters(scope({ category: 'youtube', hiddenCategories: ['YOUTUBE'] }));
    expect(filters.category).toEqual(['YOUTUBE']);
  });

  it('leaves the filter off entirely when nothing is hidden', () => {
    expect(buildSentenceFilters(scope()).category).toBeUndefined();
  });

  /**
   * An empty `filters.category` is read server-side as "no filter", so sending one
   * for a reader who hid every category would hand back the whole corpus instead of
   * nothing. The API refuses to store that state; this is the belt to its braces.
   */
  it('omits the filter rather than sending an empty list when every category is hidden', () => {
    const filters = buildSentenceFilters(scope({ hiddenCategories: ['ANIME', 'JDRAMA', 'YOUTUBE'] }));
    expect(filters.category).toBeUndefined();
  });
});

/**
 * A reader who hides a lot of shows is the case that broke: the whole hidden list rides in
 * `filters.media.exclude` on every search, and once it passed the API's ceiling each search
 * came back `400 Validation Failed` while the same search worked logged out.
 *
 * The list must go out whole. Truncating it to fit a ceiling would be worse than the error
 * it avoids -- the reader would silently start seeing shows they had hidden, with nothing
 * to indicate why. If the ceiling is ever a problem again the exclusion has to move server
 * side, not lose entries here.
 */
describe('search filters with a large hidden-media list', () => {
  const hiddenMedia = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ mediaPublicId: `media${String(i).padStart(7, '0')}` }));

  it('forwards a large hidden list whole rather than truncating it', () => {
    const hidden = hiddenMedia(500);

    const sentences = buildSentenceFilters(scope({ hiddenMediaExclude: hidden }));
    const stats = buildStatsFilters(scope({ hiddenMediaExclude: hidden }));

    expect(sentences.media?.exclude).toEqual(hidden);
    expect(stats.media?.exclude).toEqual(hidden);
  });

  it('keeps every entry when the reader also has media explicitly requested', () => {
    const hidden = hiddenMedia(500);
    // `?media=` suppresses the exclusion on the result list, but the tab counts still
    // carry it -- so the large list has to survive that path too.
    const stats = buildStatsFilters(scope({ hiddenMediaExclude: hidden, mediaPublicId: 'media0000042' }));

    expect(stats.media?.exclude).toHaveLength(500);
    expect(stats.media?.exclude?.at(-1)).toEqual({ mediaPublicId: 'media0000499' });
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

  // A corpus search is the path an anonymous visitor takes, so it is the one that
  // actually meets Cloudflare challenges and expired sessions. It used to call
  // every empty response an error, unlike the collection path right above.
  it('distinguishes a forbidden corpus search from a failed one', async () => {
    const fetcher = createSearchFetcher(fakeSdk);

    sdkMocks.search.mockResolvedValueOnce({ error: {}, response: new Response(null, { status: 403 }) });
    expect(await fetcher.fetchSentences(scope())).toEqual({ status: 'forbidden' });

    sdkMocks.search.mockResolvedValueOnce({ error: {}, response: new Response(null, { status: 401 }) });
    expect(await fetcher.fetchSentences(scope())).toEqual({ status: 'forbidden' });
  });

  // A transport failure resolves with no `response` at all rather than throwing,
  // so it lands on the same branch a 500 does. It stays out of the issue list --
  // nothing here is ours to fix -- but it is still counted, because an edge
  // outage while the origin is healthy shows up nowhere else.
  it('counts a request that never got a response instead of filing it as an issue', async () => {
    const fetcher = createSearchFetcher(fakeSdk);

    sdkMocks.search.mockResolvedValueOnce({ error: {}, response: undefined });
    expect(await fetcher.fetchSentences(scope())).toEqual({ status: 'error' });
    expect(reportErrorMock).not.toHaveBeenCalled();
    expect(reportEventMock).toHaveBeenCalledWith(
      'search_fetch_failed',
      expect.objectContaining({ 'http.status_code': '0', 'search.kind': 'sentences' }),
    );
  });

  it('drops a 429 outright, since the server already counts its own throttling', async () => {
    const fetcher = createSearchFetcher(fakeSdk);

    sdkMocks.search.mockResolvedValueOnce({ error: {}, response: new Response(null, { status: 429 }) });
    expect(await fetcher.fetchSentences(scope())).toEqual({ status: 'error' });
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it('still reports a fault the server owns', async () => {
    const fetcher = createSearchFetcher(fakeSdk);

    sdkMocks.search.mockResolvedValueOnce({ error: {}, response: new Response(null, { status: 502 }) });
    expect(await fetcher.fetchSentences(scope())).toEqual({ status: 'error' });
    expect(reportErrorMock).toHaveBeenCalledWith(
      'search:sentences-fetch-failed',
      expect.any(Error),
      expect.objectContaining({ 'http.status_code': '502' }),
    );
  });

  // The one case the issue was opened for that IS a bug: a 200 whose body did
  // not parse into anything. Silencing this alongside the transport failures
  // would leave nothing watching it.
  it('still reports a 200 that carried no body', async () => {
    const fetcher = createSearchFetcher(fakeSdk);

    sdkMocks.search.mockResolvedValueOnce({ data: undefined, response: new Response(null, { status: 200 }) });
    expect(await fetcher.fetchSentences(scope())).toEqual({ status: 'error' });
    expect(reportErrorMock).toHaveBeenCalledWith(
      'search:sentences-fetch-failed',
      expect.any(Error),
      expect.objectContaining({ 'http.status_code': '200' }),
    );
  });
});

describe('fetchStats', () => {
  it('distinguishes a forbidden corpus stats fetch from a failed one', async () => {
    const fetcher = createSearchFetcher(fakeSdk);

    sdkMocks.getSearchStats.mockResolvedValueOnce({ error: {}, response: new Response(null, { status: 403 }) });
    expect(await fetcher.fetchStats(scope())).toEqual({ status: 'forbidden' });

    sdkMocks.getSearchStats.mockResolvedValueOnce({ error: {}, response: new Response(null, { status: 500 }) });
    expect(await fetcher.fetchStats(scope())).toEqual({ status: 'error' });
  });

  // The stats fetch fires alongside the sentences one, so a reader whose network
  // drops produces two reports for one event. Same rule, applied on both paths.
  it('counts a stats request that never got a response, on the same rule', async () => {
    const fetcher = createSearchFetcher(fakeSdk);

    sdkMocks.getSearchStats.mockResolvedValueOnce({ error: {}, response: undefined });
    expect(await fetcher.fetchStats(scope())).toEqual({ status: 'error' });
    expect(reportErrorMock).not.toHaveBeenCalled();
    expect(reportEventMock).toHaveBeenCalledWith(
      'search_fetch_failed',
      expect.objectContaining({ 'http.status_code': '0', 'search.kind': 'stats' }),
    );
  });

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

/**
 * What reaches the wire, for the tie-break the backend applies under the default
 * order. The backend ignores the list under every other sort, so the assertions
 * about omission are about not sending 120 identifiers to be thrown away rather
 * than about correctness of the result.
 */
describe('fetchSentences preferMedia', () => {
  const okOnce = () => sdkMocks.search.mockResolvedValueOnce({ data: searchPayload('s1'), response: new Response() });
  const bodyOf = () => sdkMocks.search.mock.calls[0]![0].body;

  it('sends the reader’s titles when no explicit sort was asked for', async () => {
    okOnce();

    await createSearchFetcher(fakeSdk).fetchSentences(scope({ preferMedia: ['aaaaaaaaaaaa', 'bbbbbbbbbbbb'] }));

    expect(bodyOf().preferMedia).toEqual(['aaaaaaaaaaaa', 'bbbbbbbbbbbb']);
  });

  it('sends it for an explicit RELEVANCE too, which means the same order', async () => {
    okOnce();

    await createSearchFetcher(fakeSdk).fetchSentences(scope({ sort: 'relevance', preferMedia: ['aaaaaaaaaaaa'] }));

    expect(bodyOf().preferMedia).toEqual(['aaaaaaaaaaaa']);
  });

  it('omits it under a sort the reader named', async () => {
    for (const sort of ['time_asc', 'time_desc', 'asc', 'desc', 'random']) {
      sdkMocks.search.mockReset();
      okOnce();

      await createSearchFetcher(fakeSdk).fetchSentences(scope({ sort, preferMedia: ['aaaaaaaaaaaa'] }));

      expect(bodyOf()).not.toHaveProperty('preferMedia');
    }
  });

  it('omits it entirely when there is nothing to prefer, rather than sending an empty list', async () => {
    okOnce();

    await createSearchFetcher(fakeSdk).fetchSentences(scope({ preferMedia: [] }));

    expect(bodyOf()).not.toHaveProperty('preferMedia');
  });

  it('clamps to the schema’s maximum, since going over is a 400 on the search itself', async () => {
    okOnce();
    const many = Array.from({ length: 200 }, (_, i) => `media${String(i).padStart(7, '0')}`);

    await createSearchFetcher(fakeSdk).fetchSentences(scope({ preferMedia: many }));

    expect(bodyOf().preferMedia).toHaveLength(120);
    expect(bodyOf().preferMedia[0]).toBe(many[0]);
  });
});
