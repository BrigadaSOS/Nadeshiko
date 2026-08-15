import { describe, it, expect, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { estypes } from '@elastic/elasticsearch';
import { SegmentDocument } from '@app/services/search/SegmentDocument';
import { client } from '@config/elasticsearch';
import { Media } from '@app/models';
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
