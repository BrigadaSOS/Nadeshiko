import { describe, it, expect, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { estypes } from '@elastic/elasticsearch';
import { SegmentDocument } from '@app/services/search/SegmentDocument';
import { client } from '@config/elasticsearch';
import { Media, Segment } from '@app/models';
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

// These cases look at the single search a plain keyset page makes. Rounds by title (which add collapse queries) have
// their own suites.
vi.mock('@app/services/search/segmentDocument/variety', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/services/search/segmentDocument/variety')>()),
  shouldDiversify: () => false,
}));

type MediaInfoMap = Awaited<ReturnType<typeof Media.getMediaInfoMap>>;

const emptyMediaInfoMap = { results: new Map() } as unknown as MediaInfoMap;

const failedSubSearch = { status: 400, error: { type: 'parsing_exception', reason: 'boom' } };
const emptySubSearch = { status: 200, hits: { total: { value: 0, relation: 'eq' }, hits: [] } };

afterEach(() => {
  vi.spyOn(client, 'msearch').mockRestore();
  vi.spyOn(client, 'search').mockRestore();
  vi.spyOn(Media, 'getMediaInfoMap').mockRestore();
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
  /** Return `any` for raw Elasticsearch JSON so the assertions can name missing clauses directly instead of failing
   * with an incidental property-access error. */
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

describe('SegmentDocument.search recurring opening/ending repeats', () => {
  /** The query of the one Elasticsearch search a plain page makes, as JSON, for a clause check. */
  async function searchQueryJson(request: Record<string, unknown>): Promise<{ json: string; calls: number }> {
    vi.spyOn(Media, 'getMediaInfoMap').mockResolvedValue(emptyMediaInfoMap);
    const search = vi.spyOn(client, 'search').mockResolvedValue({
      hits: { total: { value: 0, relation: 'eq' }, hits: [] },
    } as unknown as estypes.SearchResponse);
    await SegmentDocument.search({ query: { search: 'opening', exactMatch: false }, take: 2, ...request } as never);
    return { json: JSON.stringify(search.mock.calls[0]?.[0]?.query), calls: search.mock.calls.length };
  }
  const HIDES = '{"term":{"recurringRepeat":true}}';

  it('leaves them out of the reader view with one clause, in a single Elasticsearch search', async () => {
    const find = vi.spyOn(Segment, 'find');
    const { json, calls } = await searchQueryJson({});

    expect(json).toContain(HIDES);
    expect(calls).toBe(1);
    // The flag is in the index: no Postgres lookup and no re-query.
    expect(find).not.toHaveBeenCalled();
    find.mockRestore();
  });

  it('keeps them when one episode is in scope, so its opening can be found there', async () => {
    const { json } = await searchQueryJson({
      filters: { media: { include: [{ mediaPublicId: 'm', mediaId: 1, episodes: [3] }] } },
    });
    expect(json).not.toContain(HIDES);
  });

  it('keeps them when the request asks for more than active segments', async () => {
    const { json } = await searchQueryJson({ filters: { status: ['ACTIVE', 'DELETED'] } });
    expect(json).not.toContain(HIDES);
  });
});
