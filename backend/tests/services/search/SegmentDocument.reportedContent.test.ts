import { describe, it, expect, afterEach, vi } from 'vitest';
import type { estypes } from '@elastic/elasticsearch';
import { SegmentDocument } from '@app/services/search/SegmentDocument';
import { PREFERRED_MEDIA_SCORE_WEIGHT } from '@app/services/search/segmentDocument/SegmentQuery';
import { client } from '@config/elasticsearch';
import { Media } from '@app/models';

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

// Stands in for the database read. Which titles earn which weight is covered in
// tests/services/reports/reportedContent.test.ts; what this file checks is that
// they reach the Elasticsearch request, in the right clause, alongside the
// reader's own preferences.
const reported = { segmentIds: new Set<number>(), mediaWeights: new Map<number, number>() };
vi.mock('@app/services/reports/reportedContent', () => ({
  getUnhandledReports: async () => reported,
}));

type MediaInfoMap = Awaited<ReturnType<typeof Media.getMediaInfoMap>>;
const emptyMediaInfoMap = { results: new Map() } as unknown as MediaInfoMap;

type Scenario = {
  mediaWeights?: [number, number][];
  segmentIds?: number[];
  preferMedia?: string[];
};

/** The query as Elasticsearch received it. Raw JSON, so `any` -- see the note in errorPaths. */
async function searchQuery({ mediaWeights = [], segmentIds = [], preferMedia }: Scenario): Promise<any> {
  reported.mediaWeights = new Map(mediaWeights);
  reported.segmentIds = new Set(segmentIds);

  vi.spyOn(Media, 'getMediaInfoMap').mockResolvedValue(emptyMediaInfoMap);
  const search = vi.spyOn(client, 'search').mockResolvedValue({
    hits: { total: { value: 0, relation: 'eq' }, hits: [] },
  } as unknown as estypes.SearchResponse);

  // Straight through SegmentDocument rather than the controller, so `preferMedia`
  // arrives already resolved to internal ids -- the controller's job, tested there.
  await SegmentDocument.search(
    { take: 10, query: { search: 'ねこ' } } as any,
    'strict',
    preferMedia ? new Set(preferMedia.map(Number)) : undefined,
  );

  // Thrown here rather than left to fail on a property access, so a search that
  // never happened names itself instead of surfacing as "cannot read 'bool'".
  const params = search.mock.calls[0]?.[0] as estypes.SearchRequest | undefined;
  if (!params) throw new Error('Elasticsearch search was never called');

  return params.query;
}

afterEach(() => {
  vi.spyOn(client, 'search').mockRestore();
  vi.spyOn(Media, 'getMediaInfoMap').mockRestore();
});

describe('search, unhandled reports and preferences', () => {
  it('leaves the query alone when nothing is reported or preferred', async () => {
    const query = await searchQuery({});

    expect(query.function_score).toBeUndefined();
    expect(query.bool.must_not).toEqual([]);
  });

  it('excludes reported segments by id', async () => {
    const query = await searchQuery({ segmentIds: [11, 22] });

    // must_not, not a score penalty: a reported line is wrong, not merely worse.
    expect(query.bool.must_not).toEqual([{ ids: { values: ['11', '22'] } }]);
  });

  it('keeps a reported segment out of results without demoting its title', async () => {
    // The two are separate decisions on purpose: reporting one line must not
    // penalise the other tens of thousands in the same title.
    const query = await searchQuery({ segmentIds: [11] });

    expect(query.function_score).toBeUndefined();
    expect(query.bool.must_not).toEqual([{ ids: { values: ['11'] } }]);
  });

  it('demotes reported titles without excluding them', async () => {
    const query = await searchQuery({ mediaWeights: [[5, 0.35]] });

    expect(query.function_score.functions).toEqual([{ filter: { terms: { mediaId: [5] } }, weight: 0.35 }]);
    expect(query.function_score.query.bool.must_not).toEqual([]);
  });

  it('boosts the titles the reader prefers', async () => {
    const query = await searchQuery({ preferMedia: ['5'] });

    expect(query.function_score.functions).toEqual([
      { filter: { terms: { mediaId: [5] } }, weight: PREFERRED_MEDIA_SCORE_WEIGHT },
    ]);
  });

  it('leaves a preferred title demoted when it is also reported', async () => {
    const query = await searchQuery({ mediaWeights: [[5, 0.35]], preferMedia: ['5'] });

    const product = query.function_score.functions.reduce((acc: number, fn: any) => acc * fn.weight, 1);
    expect(query.function_score.score_mode).toBe('multiply');
    expect(product).toBeLessThan(1);
  });

  it('applies every lever at once', async () => {
    const query = await searchQuery({ mediaWeights: [[5, 0.2]], segmentIds: [11], preferMedia: ['8'] });

    expect(query.function_score.functions).toEqual([
      { filter: { terms: { mediaId: [5] } }, weight: 0.2 },
      { filter: { terms: { mediaId: [8] } }, weight: PREFERRED_MEDIA_SCORE_WEIGHT },
    ]);
    expect(query.function_score.query.bool.must_not).toEqual([{ ids: { values: ['11'] } }]);
  });
});
