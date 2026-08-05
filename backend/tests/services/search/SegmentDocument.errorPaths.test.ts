import { describe, it, expect, afterEach, spyOn, vi } from 'bun:test';
import type { estypes } from '@elastic/elasticsearch';
import { SegmentDocument } from '@app/services/search/SegmentDocument';
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

type MediaInfoMap = Awaited<ReturnType<typeof Media.getMediaInfoMap>>;

const emptyMediaInfoMap = { results: new Map() } as unknown as MediaInfoMap;

const failedSubSearch = { status: 400, error: { type: 'parsing_exception', reason: 'boom' } };
const emptySubSearch = { status: 200, hits: { total: { value: 0, relation: 'eq' }, hits: [] } };

afterEach(() => {
  spyOn(client, 'msearch').mockRestore();
  spyOn(client, 'search').mockRestore();
  spyOn(Media, 'getMediaInfoMap').mockRestore();
});

describe('SegmentDocument.surroundingSegments', () => {
  it('returns an empty context instead of throwing when a sub-search fails', async () => {
    spyOn(Media, 'getMediaInfoMap').mockResolvedValue(emptyMediaInfoMap);
    spyOn(client, 'msearch').mockResolvedValue({
      took: 1,
      responses: [failedSubSearch, failedSubSearch],
    } as unknown as estypes.MsearchResponse);

    const result = await SegmentDocument.surroundingSegments({ mediaId: 1, episodeNumber: 1, segmentPosition: 5 });

    expect(result.segments).toEqual([]);
    expect(result.includes.media).toEqual({});
  });

  it('still returns the healthy half when only one sub-search fails', async () => {
    spyOn(Media, 'getMediaInfoMap').mockResolvedValue(emptyMediaInfoMap);
    spyOn(client, 'msearch').mockResolvedValue({
      took: 1,
      responses: [emptySubSearch, failedSubSearch],
    } as unknown as estypes.MsearchResponse);

    await expect(
      SegmentDocument.surroundingSegments({ mediaId: 1, episodeNumber: 1, segmentPosition: 5 }),
    ).resolves.toBeDefined();
  });
});

describe('SegmentDocument.findByIds', () => {
  it('chunks the id list so a large collection cannot exceed max_result_window', async () => {
    spyOn(Media, 'getMediaInfoMap').mockResolvedValue(emptyMediaInfoMap);
    const search = spyOn(client, 'search').mockResolvedValue({
      hits: { total: { value: 0, relation: 'eq' }, hits: [] },
    } as unknown as estypes.SearchResponse);

    const ids = Array.from({ length: 2500 }, (_, index) => index + 1);
    await SegmentDocument.findByIds(ids);

    const sizes = search.mock.calls.map(([params]) => (params as estypes.SearchRequest).size);
    expect(sizes).toEqual([1000, 1000, 500]);
    expect(sizes.every((size) => (size ?? 0) <= 10000)).toBe(true);
  });

  it('does not query Elasticsearch for an empty id list', async () => {
    const search = spyOn(client, 'search');

    const result = await SegmentDocument.findByIds([]);

    expect(result).toEqual({ segments: [], includes: { media: {} } });
    expect(search).not.toHaveBeenCalled();
  });
});
