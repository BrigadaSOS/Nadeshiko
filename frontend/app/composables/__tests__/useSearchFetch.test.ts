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
  buildMediaStatsFilters,
  buildSentenceFilters,
  buildStatsFilters,
  createRequestSequencer,
  createSearchFetcher,
  stripEpisodeHits,
  stripUnreadTokenFields,
  type SearchScope,
} from '../useSearchFetch';
import type { SearchResponse, SearchStatsResponse } from '~/types/search';

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
  // Reset too, or a test asserting that nothing was COUNTED reads every earlier
  // test's events and fails on history rather than on behaviour.
  reportEventMock.mockReset();
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

/**
 * What the page serializes into `__NUXT_DATA__`. The assertions are about size
 * as much as shape: 81% of a title page's payload was per-episode counts for
 * titles the page is not about.
 */
describe('SSR payload slimming', () => {
  const stat = (mediaPublicId: string, episodes: number[]) => ({
    mediaPublicId,
    matchCount: episodes.length,
    episodeHits: episodes.map((episode) => ({ episode, hitCount: 3 })),
    nameRomaji: '',
    nameEn: '',
    nameJa: '',
    category: 'ANIME' as const,
    airingFormat: 'TV' as const,
    slug: mediaPublicId,
  });

  const stats = (): SearchStatsResponse => ({
    media: [stat('keep-me', [1, 2, 3]), stat('drop-me', [1, 2]), stat('drop-me-too', [7])],
    categories: [{ category: 'ANIME', count: 6, realCount: 6 }],
  });

  it('keeps the named title’s episode counts and empties every other one', () => {
    const slim = stripEpisodeHits(stats(), 'keep-me');

    expect(slim.media.map((entry) => entry.episodeHits.length)).toEqual([3, 0, 0]);
    // Emptied, not removed: the drawer's rule is "an empty list means ask".
    expect(slim.media[1]).toHaveProperty('episodeHits', []);
    // Everything the tabs and the title list read is untouched.
    expect(slim.media.map((entry) => entry.matchCount)).toEqual([3, 2, 1]);
    expect(slim.categories).toEqual(stats().categories);
  });

  it('empties all of them when the URL named no title', () => {
    expect(stripEpisodeHits(stats(), null).media.every((entry) => entry.episodeHits.length === 0)).toBe(true);
  });

  it('does not mutate the response it was handed', () => {
    const original = stats();
    stripEpisodeHits(original, 'keep-me');

    expect(original.media[1]?.episodeHits).toHaveLength(2);
  });

  const token = () => ({
    s: '焼けた',
    d: '焼ける',
    r: 'ヤケタ',
    b: 0,
    e: 3,
    p: '動詞',
    pt: 'verb',
    kind: 'inflected',
    posLabel: 'Verb',
    f: [{ t: '焼', r: 'や' }, { t: 'けた' }],
    inflection: { labels: ['past'], base: '焼ける' },
  });

  const response = (): SearchResponse =>
    ({
      results: [{ segment: { textJa: { content: '焼けた', highlight: '', tokens: [token(), token()] } } }],
    }) as unknown as SearchResponse;

  it('drops the token label nothing renders and keeps everything that addresses the text', () => {
    const slim = stripUnreadTokenFields(response());
    const [first] = slim.results[0]!.segment.textJa.tokens;

    expect(first).not.toHaveProperty('posLabel');
    // `b`/`e` decide the highlight and the Anki furigana slicing, `p`/`pt` the
    // dictionary lookup, `kind` whether the token is askable at all.
    expect(first).toMatchObject({ s: '焼けた', d: '焼ける', r: 'ヤケタ', b: 0, e: 3, p: '動詞', pt: 'verb' });
    expect(first).toHaveProperty('kind', 'inflected');
    expect(first).toHaveProperty('f');
    expect(first).toHaveProperty('inflection');
  });

  it('leaves a result with no tokens alone', () => {
    const untokenized = {
      results: [{ segment: { textJa: { content: 'ねこ', highlight: '', tokens: [] } } }],
    } as unknown as SearchResponse;

    expect(stripUnreadTokenFields(untokenized).results[0]).toBe(untokenized.results[0]);
  });
});

describe('buildMediaStatsFilters', () => {
  it('asks for the one title, all of its episodes, hidden or not', () => {
    const filters = buildMediaStatsFilters(
      scope({
        mediaPublicId: 'media-1',
        // The reader has an episode open. The drawer still has to list its siblings.
        episode: 4,
        hiddenMediaExclude: [{ mediaPublicId: 'media-1' }],
      }),
    );

    expect(filters.media?.include).toEqual([{ mediaPublicId: 'media-1' }]);
    expect(filters.media?.exclude).toBeUndefined();
  });
});

describe('fetchStats scoped to one title', () => {
  const bodyOf = () => sdkMocks.getSearchStats.mock.calls[0]![0].body;

  it('sends the media filter and skips the includes it would not read', async () => {
    sdkMocks.getSearchStats.mockResolvedValueOnce({
      data: {
        media: [{ mediaPublicId: 'media-1', matchCount: 2, episodeHits: [{ episode: 1, hitCount: 2 }] }],
        categories: [],
      },
      response: new Response(),
    });

    const outcome = await createSearchFetcher(fakeSdk).fetchStats(scope({ mediaPublicId: 'media-1' }), {
      scopeToSelectedMedia: true,
    });

    expect(bodyOf().filters.media?.include).toEqual([{ mediaPublicId: 'media-1' }]);
    expect(bodyOf().include).toBeUndefined();
    expect(outcome).toMatchObject({ status: 'ok' });
  });

  it('leaves the tab counts unscoped by default', async () => {
    sdkMocks.getSearchStats.mockResolvedValueOnce({ data: { media: [], categories: [] }, response: new Response() });

    await createSearchFetcher(fakeSdk).fetchStats(scope({ mediaPublicId: 'media-1' }));

    expect(bodyOf().filters.media).toBeUndefined();
    expect(bodyOf().include).toEqual(['media']);
  });
});

describe('a permalink to one sentence', () => {
  const segment = { publicId: 'seg-9', mediaPublicId: 'media-1' };
  const media = { publicId: 'media-1', nameEn: 'Oshi no Ko' };

  const permalink = () => scope({ segmentPublicId: 'seg-9', query: '' });

  beforeEach(() => {
    sdkMocks.getSegment.mockResolvedValue({ data: segment, response: new Response() });
    sdkMocks.getMedia.mockResolvedValue({ data: media, response: new Response() });
  });

  it('resolves that one segment instead of searching', async () => {
    // `?uuid=` ignores every other filter: the reader followed a link to one
    // sentence, and running their filters over it could answer with nothing.
    const fetcher = createSearchFetcher(fakeSdk);

    const outcome = await fetcher.fetchSentences(permalink());

    expect(sdkMocks.search).not.toHaveBeenCalled();
    expect(sdkMocks.getSegment).toHaveBeenCalledWith(expect.objectContaining({ path: { segmentPublicId: 'seg-9' } }));
    expect(outcome).toEqual({
      status: 'ok',
      data: expect.objectContaining({ results: [expect.objectContaining({ segment })] }),
    });
  });

  it('fetches the title the segment belongs to, so the card is not nameless', async () => {
    // The segment endpoint answers with an id, not a title; a card with no
    // media name is the shape a permalink is most often shared as.
    const fetcher = createSearchFetcher(fakeSdk);

    await fetcher.fetchSentences(permalink());

    expect(sdkMocks.getMedia).toHaveBeenCalledWith(expect.objectContaining({ path: { mediaPublicId: 'media-1' } }));
  });

  it('a permalink to a segment that is gone is not a crash', async () => {
    // Deleted, or a link that was mistyped. Both are ordinary.
    sdkMocks.getSegment.mockResolvedValueOnce({ error: {}, response: new Response(null, { status: 404 }) });
    const fetcher = createSearchFetcher(fakeSdk);

    expect(await fetcher.fetchSentences(permalink())).toEqual({ status: 'error' });
    expect(sdkMocks.getMedia).not.toHaveBeenCalled();
  });

  it('and one the reader may not see is forbidden rather than broken', async () => {
    sdkMocks.getSegment.mockResolvedValueOnce({ error: {}, response: new Response(null, { status: 403 }) });
    const fetcher = createSearchFetcher(fakeSdk);

    expect(await fetcher.fetchSentences(permalink())).toEqual({ status: 'forbidden' });
  });

  it('still shows the sentence when only the TITLE lookup fails', async () => {
    // The sentence is what the reader followed the link for; losing it because
    // its title could not be fetched trades everything for a label.
    sdkMocks.getMedia.mockResolvedValueOnce({ error: {}, response: new Response(null, { status: 500 }) });
    const fetcher = createSearchFetcher(fakeSdk);

    const outcome = await fetcher.fetchSentences(permalink());

    expect(outcome).toEqual({
      status: 'ok',
      data: expect.objectContaining({ results: [expect.objectContaining({ segment })] }),
    });
  });

  it('is reported stale when a newer request has already started', async () => {
    const slow = deferred<unknown>();
    sdkMocks.getSegment.mockReturnValueOnce(slow.promise);
    const fetcher = createSearchFetcher(fakeSdk);

    const first = fetcher.fetchSentences(permalink());
    await fetcher.fetchSentences(scope());
    slow.resolve({ data: segment, response: new Response() });

    expect(await first).toEqual({ status: 'stale' });
    // And the title behind it is never fetched: the check sits between the two
    // calls precisely so an abandoned permalink does not spend a second round
    // trip on a card nobody is waiting for.
    expect(sdkMocks.getMedia).not.toHaveBeenCalled();
  });
});

describe('listing a collection', () => {
  const collection = () => scope({ collectionId: 'col-1', query: '' });
  const payload = {
    segments: [{ publicId: 'seg-1', mediaPublicId: 'media-1' }],
    includes: { media: {} },
    pagination: { hasMore: false, cursor: '', estimatedTotalHits: 1, estimatedTotalHitsRelation: 'EXACT' },
  };

  it('asks the collection endpoint rather than the corpus one', async () => {
    // A collection is a list the reader made; running a corpus search over it
    // would answer with sentences that are not in it.
    sdkMocks.searchCollectionSegments.mockResolvedValueOnce({ data: payload, response: new Response() });
    const fetcher = createSearchFetcher(fakeSdk);

    await fetcher.fetchSentences(collection());

    expect(sdkMocks.search).not.toHaveBeenCalled();
    expect(sdkMocks.searchCollectionSegments).toHaveBeenCalledWith(
      expect.objectContaining({ path: { collectionPublicId: 'col-1' } }),
    );
  });

  it('uses the collection page size, which is its own number', async () => {
    sdkMocks.searchCollectionSegments.mockResolvedValueOnce({ data: payload, response: new Response() });
    const fetcher = createSearchFetcher(fakeSdk);

    await fetcher.fetchSentences(collection());

    expect(sdkMocks.searchCollectionSegments.mock.calls[0]![0].body.take).toBe(COLLECTION_PAGE_SIZE);
    expect(COLLECTION_PAGE_SIZE).not.toBe(SEARCH_PAGE_SIZE);
  });

  it('passes the cursor through when paging further in', async () => {
    sdkMocks.searchCollectionSegments.mockResolvedValueOnce({ data: payload, response: new Response() });
    const fetcher = createSearchFetcher(fakeSdk);

    await fetcher.fetchSentences(collection(), { cursor: 'page-2' });

    expect(sdkMocks.searchCollectionSegments.mock.calls[0]![0].body.cursor).toBe('page-2');
  });

  it('omits the cursor entirely on the first page', async () => {
    // Not `cursor: undefined`: the body is sent as-is and a null cursor is a
    // 400 on some of these endpoints.
    sdkMocks.searchCollectionSegments.mockResolvedValueOnce({ data: payload, response: new Response() });
    const fetcher = createSearchFetcher(fakeSdk);

    await fetcher.fetchSentences(collection());

    expect(sdkMocks.searchCollectionSegments.mock.calls[0]![0].body).not.toHaveProperty('cursor');
  });

  it('a collection the reader may not read is forbidden, not broken', async () => {
    // Someone else's private list: the page shows "you cannot see this", which
    // is a different screen from "something went wrong".
    sdkMocks.searchCollectionSegments.mockResolvedValueOnce({
      error: {},
      response: new Response(null, { status: 403 }),
    });
    const fetcher = createSearchFetcher(fakeSdk);

    expect(await fetcher.fetchSentences(collection())).toEqual({ status: 'forbidden' });
  });

  it('and a throttled one is an error nobody files a bug for', async () => {
    // 429 is the server asking for less, answered by backing off; it already
    // counts its own throttling.
    sdkMocks.searchCollectionSegments.mockResolvedValueOnce({
      error: {},
      response: new Response(null, { status: 429 }),
    });
    const fetcher = createSearchFetcher(fakeSdk);

    expect(await fetcher.fetchSentences(collection())).toEqual({ status: 'error' });
    expect(reportErrorMock).not.toHaveBeenCalled();
    expect(reportEventMock).not.toHaveBeenCalled();
  });

  it('reports a thrown collection fetch as a collection, not as the corpus', async () => {
    // The two fail for different reasons and the scope is how they are told
    // apart in triage.
    sdkMocks.searchCollectionSegments.mockRejectedValueOnce(new Error('offline'));
    const fetcher = createSearchFetcher(fakeSdk);

    expect(await fetcher.fetchSentences(collection())).toEqual({ status: 'error' });
    expect(reportErrorMock).toHaveBeenCalledWith(
      'search:sentences-fetch-failed',
      expect.anything(),
      expect.objectContaining({ 'search.scope': 'collection' }),
    );
  });
});

describe('a collection’s own counts', () => {
  const collection = () => scope({ collectionId: 'col-1', query: '' });

  it('come from the collection endpoint', async () => {
    sdkMocks.getCollectionStats.mockResolvedValueOnce({
      data: { totalSegments: 3, categories: [] },
      response: new Response(),
    });
    const fetcher = createSearchFetcher(fakeSdk);

    await fetcher.fetchStats(collection());

    expect(sdkMocks.getSearchStats).not.toHaveBeenCalled();
    expect(sdkMocks.getCollectionStats).toHaveBeenCalledWith(
      expect.objectContaining({ path: { collectionPublicId: 'col-1' } }),
    );
  });

  it('a forbidden collection is forbidden here too', async () => {
    sdkMocks.getCollectionStats.mockResolvedValueOnce({ error: {}, response: new Response(null, { status: 403 }) });
    const fetcher = createSearchFetcher(fakeSdk);

    expect(await fetcher.fetchStats(collection())).toEqual({ status: 'forbidden' });
  });

  it('and a superseded one is stale rather than a second answer', async () => {
    const slow = deferred<unknown>();
    sdkMocks.getCollectionStats.mockReturnValueOnce(slow.promise);
    sdkMocks.getSearchStats.mockResolvedValueOnce({
      data: { totalSegments: 1, categories: [] },
      response: new Response(),
    });
    const fetcher = createSearchFetcher(fakeSdk);

    const first = fetcher.fetchStats(collection());
    await fetcher.fetchStats(scope());
    slow.resolve({ data: { totalSegments: 3, categories: [] }, response: new Response() });

    expect(await first).toEqual({ status: 'stale' });
  });
});

describe('the sort a search is sent with', () => {
  beforeEach(() => {
    sdkMocks.search.mockResolvedValue({ data: searchPayload('seg-1'), response: new Response() });
  });

  const sentSort = () => sdkMocks.search.mock.calls.at(-1)![0].body.sort;

  it('sends nothing at all for relevance, which is the backend’s default', async () => {
    await createSearchFetcher(fakeSdk).fetchSentences(scope({ sort: 'relevance' }));

    expect(sentSort()).toBeUndefined();
  });

  it('sends nothing when no sort was asked for', async () => {
    await createSearchFetcher(fakeSdk).fetchSentences(scope({ sort: null }));

    expect(sentSort()).toBeUndefined();
  });

  it('upper-cases what the URL carried, since the API takes an enum', async () => {
    await createSearchFetcher(fakeSdk).fetchSentences(scope({ sort: 'newest' }));

    expect(sentSort()).toEqual({ mode: 'NEWEST' });
  });

  it('carries the seed for a shuffle, so a shared link is the same order', async () => {
    await createSearchFetcher(fakeSdk).fetchSentences(scope({ sort: 'random', randomSeed: 4242 }));

    expect(sentSort()).toEqual({ mode: 'RANDOM', seed: 4242 });
  });

  it('sends a shuffle with no seed as a bare mode', async () => {
    // The backend then derives one from the calendar day: a fine default for a
    // shared link, and useless for reshuffling -- which is why reshuffling
    // writes a new seed rather than asking again without one.
    await createSearchFetcher(fakeSdk).fetchSentences(scope({ sort: 'random', randomSeed: null }));

    expect(sentSort()).toEqual({ mode: 'RANDOM' });
  });
});
