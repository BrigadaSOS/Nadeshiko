import { describe, it, expect, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { estypes } from '@elastic/elasticsearch';
import { SegmentDocument } from '@app/services/search/SegmentDocument';
import { client } from '@config/elasticsearch';
import { Media, Segment } from '@app/models';
import { decodeKeysetCursor } from '@lib/cursor';
import { surroundingSegments } from '@app/services/search/segmentDocument/SegmentContext';

vi.mock('@config/log', () => {
  const noop = () => {};
  const mockLogger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => mockLogger,
  };
  return { logger: mockLogger, createLogger: () => mockLogger, default: mockLogger };
});

// Search reads the unhandled-report sets to hide reported segments and demote
// reported titles. That is a database read, and these cases run without one.
vi.mock('@app/services/reports/reportedContent', () => ({
  getUnhandledReports: async () => ({ segmentIds: new Set<number>(), mediaWeights: new Map<number, number>() }),
}));

type MediaInfoMap = Awaited<ReturnType<typeof Media.getMediaInfoMap>>;

const emptyMediaInfoMap = { results: new Map() } as unknown as MediaInfoMap;
let segmentFindSpy: MockInstance | undefined;

const failedSubSearch = { status: 400, error: { type: 'parsing_exception', reason: 'boom' } };
const emptySubSearch = { status: 200, hits: { total: { value: 0, relation: 'eq' }, hits: [] } };

afterEach(() => {
  vi.spyOn(client, 'msearch').mockRestore();
  vi.spyOn(client, 'search').mockRestore();
  vi.spyOn(Media, 'getMediaInfoMap').mockRestore();
  segmentFindSpy?.mockRestore();
  segmentFindSpy = undefined;
});

describe('surroundingSegments', () => {
  it('returns an empty context instead of throwing when a sub-search fails', async () => {
    vi.spyOn(Media, 'getMediaInfoMap').mockResolvedValue(emptyMediaInfoMap);
    vi.spyOn(client, 'msearch').mockResolvedValue({
      took: 1,
      responses: [failedSubSearch, failedSubSearch],
    } as unknown as estypes.MsearchResponse);

    const result = await surroundingSegments({ mediaId: 1, episodeNumber: 1, segmentPosition: 5 });

    expect(result.segments).toEqual([]);
    expect(result.includes?.media).toEqual({});
  });

  it('still returns the healthy half when only one sub-search fails', async () => {
    vi.spyOn(Media, 'getMediaInfoMap').mockResolvedValue(emptyMediaInfoMap);
    vi.spyOn(client, 'msearch').mockResolvedValue({
      took: 1,
      responses: [emptySubSearch, failedSubSearch],
    } as unknown as estypes.MsearchResponse);

    await expect(surroundingSegments({ mediaId: 1, episodeNumber: 1, segmentPosition: 5 })).resolves.toBeDefined();
  });
});

describe('SegmentDocument.searchInIds', () => {
  /**
   * The id-restricting clause from the first search call.
   *
   * Returns `any` on purpose: the assertions below reach into raw Elasticsearch
   * JSON, where every level of the real type is optional and narrowing each one
   * would bury what is being asserted. Missing clauses throw here instead, so a
   * failure names the problem rather than surfacing as "cannot read 'bool'".
   */
  function captureIdsFilter(search: MockInstance): any {
    const params = search.mock.calls[0]?.[0] as estypes.SearchRequest | undefined;
    if (!params) throw new Error('Elasticsearch search was never called');

    const filters = (params.query as estypes.QueryDslQueryContainer | undefined)?.bool?.filter as
      | estypes.QueryDslQueryContainer[]
      | undefined;
    const clause = filters?.find((candidate) => candidate && ('ids' in candidate || 'bool' in candidate));
    if (!clause) throw new Error('no id-restricting clause found in the search request');

    return clause;
  }

  function mockSearch() {
    vi.spyOn(Media, 'getMediaInfoMap').mockResolvedValue(emptyMediaInfoMap);
    return vi.spyOn(client, 'search').mockResolvedValue({
      hits: { total: { value: 0, relation: 'eq' }, hits: [] },
    } as unknown as estypes.SearchResponse);
  }

  it('sends a short id list as a single ids clause', async () => {
    const search = mockSearch();

    await SegmentDocument.searchInIds([1, 2, 3], { take: 10 } as any);

    expect(captureIdsFilter(search).ids.values).toEqual(['1', '2', '3']);
  });

  // Past `index.max_terms_count` a single `ids` clause is rejected outright. Splitting it has
  // to stay one search, because a search per chunk would mean a sort and a cursor per chunk.
  it('splits a long id list into should clauses within one search', async () => {
    const search = mockSearch();

    const ids = Array.from({ length: 2500 }, (_, index) => index + 1);
    await SegmentDocument.searchInIds(ids, { take: 10 } as any);

    expect(search).toHaveBeenCalledTimes(1);

    const clause = captureIdsFilter(search);
    expect(clause.bool.minimum_should_match).toBe(1);
    expect(clause.bool.should.map((sub: any) => sub.ids.values.length)).toEqual([1000, 1000, 500]);
    expect(clause.bool.should.flatMap((sub: any) => sub.ids.values)).toEqual(ids.map(String));
  });

  it('does not query Elasticsearch for an empty id list', async () => {
    const search = vi.spyOn(client, 'search');

    const result = await SegmentDocument.searchInIds([], { take: 10 } as any);

    expect(result.segments).toEqual([]);
    expect(result.pagination.estimatedTotalHits).toBe(0);
    expect(search).not.toHaveBeenCalled();
  });
});

describe('SegmentDocument.search duplicate paging', () => {
  it('keeps the earliest episode when relevance returns a later episode first', async () => {
    vi.spyOn(Media, 'getMediaInfoMap').mockResolvedValue({
      results: new Map([
        [
          1,
          {
            mediaId: 1,
            publicId: 'media-pub-1',
            slug: 'test-anime',
            category: 'ANIME',
            categoryName: 'ANIME',
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: undefined,
            nameRomaji: 'Test Anime',
            nameEn: 'Test Anime',
            nameJa: 'テストアニメ',
            airingFormat: 'TV',
            airingStatus: 'FINISHED',
            genres: [],
            cover: 'https://example.com/cover.jpg',
            banner: 'https://example.com/banner.jpg',
            startDate: '2025-01-01',
            endDate: undefined,
            version: '1',
            segmentCount: 3,
            episodeCount: 2,
            studio: null,
            seasonName: 'WINTER',
            seasonYear: 2025,
            externalIds: {},
            storageBasePath: 'anime/test-anime',
          },
        ],
      ]),
      stats: { totalAnimes: 1, totalSegments: 3, fullTotalAnimes: 1, fullTotalSegments: 3 },
    } as any);

    const hit = (id: string, episode: number, textJa: string, sort: number[]) => ({
      _index: 'segments',
      _id: id,
      sort,
      _source: {
        uuid: `uuid-${id}`,
        publicId: `public-${id}`,
        position: 1,
        status: 'ACTIVE',
        startTimeMs: 0,
        endTimeMs: 1000,
        durationMs: 1000,
        textJa,
        characterCount: textJa.length,
        textEn: '',
        textEnMt: false,
        textEs: '',
        textEsMt: false,
        contentRating: 'SAFE',
        storage: 'R2',
        hashedId: `hash-${id}`,
        category: 'ANIME',
        episode,
        mediaId: 1,
        storageBasePath: 'anime/test-anime',
      },
    });
    const search = vi.spyOn(client, 'search');
    segmentFindSpy = vi
      .spyOn(Segment, 'find')
      .mockResolvedValueOnce([
        { id: 1, mediaId: 1, contentJa: 'opening', episode: 1 },
        { id: 2, mediaId: 1, contentJa: 'opening', episode: 2 },
        { id: 4, mediaId: 1, contentJa: 'opening', episode: 3 },
      ] as any)
      .mockResolvedValueOnce([] as any);
    search
      .mockResolvedValueOnce({
        hits: {
          total: { value: 4, relation: 'eq' },
          hits: [hit('2', 2, 'opening', [1, 1])],
        },
      } as any)
      .mockResolvedValueOnce({
        hits: {
          total: { value: 4, relation: 'eq' },
          hits: [hit('1', 1, 'opening', [1, 2]), hit('3', 2, 'dialogue', [1, 3])],
        },
      } as any);

    const result = await SegmentDocument.search({ query: { search: 'opening', exactMatch: false }, take: 2 });

    expect(result.segments.map((segment) => segment.textJa.content)).toEqual(['opening', 'dialogue']);
    expect(search).toHaveBeenCalledTimes(2);
    const rerunParams = search.mock.calls[1]?.[0] as any;
    expect(rerunParams).toBeDefined();
    expect(rerunParams.query.bool.must_not).toHaveLength(1);
  });

  it('iterates when excluding one group reveals another duplicate group', async () => {
    vi.spyOn(Media, 'getMediaInfoMap').mockResolvedValue({
      results: new Map([
        [
          1,
          {
            mediaId: 1,
            publicId: 'media-pub-1',
            slug: 'test-anime',
            category: 'ANIME',
            categoryName: 'ANIME',
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: undefined,
            nameRomaji: 'Test Anime',
            nameEn: 'Test Anime',
            nameJa: 'テストアニメ',
            airingFormat: 'TV',
            airingStatus: 'FINISHED',
            genres: [],
            cover: 'https://example.com/cover.jpg',
            banner: 'https://example.com/banner.jpg',
            startDate: '2025-01-01',
            endDate: undefined,
            version: '1',
            segmentCount: 5,
            episodeCount: 2,
            studio: null,
            seasonName: 'WINTER',
            seasonYear: 2025,
            externalIds: {},
            storageBasePath: 'anime/test-anime',
          },
        ],
      ]),
      stats: { totalAnimes: 1, totalSegments: 5, fullTotalAnimes: 1, fullTotalSegments: 5 },
    } as any);
    const hit = (id: string, episode: number, textJa: string, sort: number[]) => ({
      _index: 'segments',
      _id: id,
      sort,
      _source: {
        uuid: `uuid-${id}`,
        publicId: `public-${id}`,
        position: 1,
        status: 'ACTIVE',
        startTimeMs: 0,
        endTimeMs: 1000,
        durationMs: 1000,
        textJa,
        characterCount: textJa.length,
        textEn: '',
        textEnMt: false,
        textEs: '',
        textEsMt: false,
        contentRating: 'SAFE',
        storage: 'R2',
        hashedId: `hash-${id}`,
        category: 'ANIME',
        episode,
        mediaId: 1,
        storageBasePath: 'anime/test-anime',
      },
    });
    segmentFindSpy = vi
      .spyOn(Segment, 'find')
      .mockResolvedValueOnce([
        { id: 1, mediaId: 1, contentJa: 'opening-a', episode: 1 },
        { id: 2, mediaId: 1, contentJa: 'opening-a', episode: 2 },
        { id: 6, mediaId: 1, contentJa: 'opening-a', episode: 3 },
      ] as any)
      .mockResolvedValueOnce([
        { id: 4, mediaId: 1, contentJa: 'opening-b', episode: 1 },
        { id: 5, mediaId: 1, contentJa: 'opening-b', episode: 2 },
        { id: 7, mediaId: 1, contentJa: 'opening-b', episode: 3 },
      ] as any)
      .mockResolvedValueOnce([] as any);
    const search = vi.spyOn(client, 'search');
    search
      .mockResolvedValueOnce({
        hits: {
          total: { value: 5, relation: 'eq' },
          hits: [hit('1', 1, 'opening-a', [1, 1]), hit('2', 2, 'opening-a', [1, 2]), hit('3', 1, 'dialogue', [1, 3])],
        },
      } as any)
      .mockResolvedValueOnce({
        hits: {
          total: { value: 5, relation: 'eq' },
          hits: [
            hit('1', 1, 'opening-a', [1, 1]),
            hit('4', 1, 'opening-b', [1, 4]),
            hit('5', 2, 'opening-b', [1, 5]),
            hit('7', 3, 'opening-b', [1, 7]),
          ],
        },
      } as any)
      .mockResolvedValueOnce({
        hits: {
          total: { value: 5, relation: 'eq' },
          hits: [hit('1', 1, 'opening-a', [1, 1]), hit('4', 1, 'opening-b', [1, 4]), hit('3', 1, 'dialogue', [1, 6])],
        },
      } as any);

    const result = await SegmentDocument.search({ query: { search: 'opening', exactMatch: false }, take: 3 });

    expect(result.segments.map((segment) => segment.textJa.content)).toEqual(['opening-a', 'opening-b', 'dialogue']);
    expect(search).toHaveBeenCalledTimes(3);
    const finalRerunParams = search.mock.calls[2]?.[0] as any;
    expect(finalRerunParams).toBeDefined();
    expect(finalRerunParams.query.bool.must_not[0].ids.values).toEqual(['2', '6', '5', '7']);
  });

  it('leaves a two-episode recurring dialogue line alone', async () => {
    vi.spyOn(Media, 'getMediaInfoMap').mockResolvedValue(emptyMediaInfoMap);
    segmentFindSpy = vi.spyOn(Segment, 'find').mockResolvedValue([
      { id: 1, mediaId: 1, contentJa: 'はい', episode: 1 },
      { id: 2, mediaId: 1, contentJa: 'はい', episode: 2 },
    ] as any);
    const search = vi.spyOn(client, 'search').mockResolvedValue({
      hits: {
        total: { value: 2, relation: 'eq' },
        hits: [{ _id: '1', _source: { mediaId: 1, episode: 1, textJa: 'はい' } }],
      },
    } as any);

    await SegmentDocument.search({ query: { search: 'はい', exactMatch: false }, take: 1 });

    expect(search).toHaveBeenCalledTimes(1);
  });

  it('keeps the cursor compact while suppressing duplicates on a later page', async () => {
    vi.spyOn(Media, 'getMediaInfoMap').mockResolvedValue({
      results: new Map([
        [
          1,
          {
            mediaId: 1,
            publicId: 'media-pub-1',
            slug: 'test-anime',
            category: 'ANIME',
            categoryName: 'ANIME',
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: undefined,
            nameRomaji: 'Test Anime',
            nameEn: 'Test Anime',
            nameJa: 'テストアニメ',
            airingFormat: 'TV',
            airingStatus: 'FINISHED',
            genres: [],
            cover: 'https://example.com/cover.jpg',
            banner: 'https://example.com/banner.jpg',
            startDate: '2025-01-01',
            endDate: undefined,
            version: '1',
            segmentCount: 4,
            episodeCount: 3,
            studio: null,
            seasonName: 'WINTER',
            seasonYear: 2025,
            externalIds: {},
            storageBasePath: 'anime/test-anime',
          },
        ],
      ]),
      stats: { totalAnimes: 1, totalSegments: 4, fullTotalAnimes: 1, fullTotalSegments: 4 },
    } as any);
    const hit = (id: string, episode: number, textJa: string, sort: number[]) => ({
      _index: 'segments',
      _id: id,
      sort,
      _source: {
        uuid: `uuid-${id}`,
        publicId: `public-${id}`,
        position: 1,
        status: 'ACTIVE',
        startTimeMs: 0,
        endTimeMs: 1000,
        durationMs: 1000,
        textJa,
        characterCount: textJa.length,
        textEn: '',
        textEnMt: false,
        textEs: '',
        textEsMt: false,
        contentRating: 'SAFE',
        storage: 'R2',
        hashedId: `hash-${id}`,
        category: 'ANIME',
        episode,
        mediaId: 1,
        storageBasePath: 'anime/test-anime',
      },
    });
    segmentFindSpy = vi
      .spyOn(Segment, 'find')
      .mockResolvedValueOnce([
        { id: 1, mediaId: 1, contentJa: 'opening', episode: 1 },
        { id: 2, mediaId: 1, contentJa: 'opening', episode: 2 },
        { id: 3, mediaId: 1, contentJa: 'opening', episode: 3 },
      ] as any)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([
        { id: 1, mediaId: 1, contentJa: 'opening', episode: 1 },
        { id: 2, mediaId: 1, contentJa: 'opening', episode: 2 },
        { id: 3, mediaId: 1, contentJa: 'opening', episode: 3 },
      ] as any)
      .mockResolvedValueOnce([] as any);
    const search = vi.spyOn(client, 'search');
    search
      .mockResolvedValueOnce({
        hits: { total: { value: 4, relation: 'eq' }, hits: [hit('2', 2, 'opening', [1, 2, 1, 2, 1])] },
      } as any)
      .mockResolvedValueOnce({
        hits: {
          total: { value: 4, relation: 'eq' },
          hits: [hit('1', 1, 'opening', [1, 3, 1, 1, 1]), hit('10', 1, 'dialogue', [1, 4, 1, 1, 2])],
        },
      } as any)
      .mockResolvedValueOnce({
        hits: { total: { value: 4, relation: 'eq' }, hits: [hit('3', 3, 'opening', [1, 5, 1, 3, 1])] },
      } as any)
      .mockResolvedValueOnce({
        hits: { total: { value: 4, relation: 'eq' }, hits: [hit('11', 3, 'ending', [1, 6, 1, 3, 2])] },
      } as any);

    const page1 = await SegmentDocument.search({ query: { search: 'opening', exactMatch: false }, take: 2 });
    const page2 = await SegmentDocument.search({
      query: { search: 'opening', exactMatch: false },
      take: 2,
      cursor: page1.pagination.cursor ?? undefined,
    });

    expect(page1.segments.map((segment) => segment.textJa.content)).toEqual(['opening', 'dialogue']);
    expect(page2.segments.map((segment) => segment.textJa.content)).toEqual(['ending']);
    expect(decodeKeysetCursor(page1.pagination.cursor ?? undefined)).toEqual([1, 4, 1, 1, 2]);
    const page2InitialParams = search.mock.calls[2]?.[0] as any;
    expect(page2InitialParams).toBeDefined();
    expect(page2InitialParams.search_after).toEqual([1, 4, 1, 1, 2]);
    expect(search).toHaveBeenCalledTimes(4);
  });

  it('returns safely after the duplicate-discovery pass budget', async () => {
    vi.spyOn(Media, 'getMediaInfoMap').mockResolvedValue(emptyMediaInfoMap);
    const hit = {
      _index: 'segments',
      _id: '1',
      sort: [1, 1, 1, 1, 1],
      _source: {
        uuid: 'uuid-1',
        publicId: 'public-1',
        position: 1,
        status: 'ACTIVE',
        startTimeMs: 0,
        endTimeMs: 1000,
        durationMs: 1000,
        textJa: 'opening',
        characterCount: 7,
        textEn: '',
        textEnMt: false,
        textEs: '',
        textEsMt: false,
        contentRating: 'SAFE',
        storage: 'R2',
        hashedId: 'hash-1',
        category: 'ANIME',
        episode: 1,
        mediaId: 1,
        storageBasePath: 'anime/test-anime',
      },
    };
    let findCalls = 0;
    segmentFindSpy = vi.spyOn(Segment, 'find').mockImplementation(async () => {
      findCalls += 1;
      return [
        { id: 1, mediaId: 1, contentJa: 'opening', episode: 1 },
        { id: 2, mediaId: 1, contentJa: 'opening', episode: 2 },
        { id: findCalls + 2, mediaId: 1, contentJa: 'opening', episode: findCalls + 2 },
      ] as any;
    });
    const search = vi.spyOn(client, 'search').mockResolvedValue({
      hits: { total: { value: 10, relation: 'eq' }, hits: [hit] },
    } as any);

    await expect(
      SegmentDocument.search({ query: { search: 'opening', exactMatch: false }, take: 1 }),
    ).resolves.toBeDefined();

    expect(findCalls).toBe(5);
    expect(search).toHaveBeenCalledTimes(6);
  });
});
