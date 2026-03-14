import { afterEach, describe, expect, it, vi } from 'bun:test';
import { Segment } from '@app/models';
import { SegmentIndexer } from '@app/models/segmentDocument/SegmentIndexer';

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

type QueryState = {
  params: Record<string, unknown>;
  selectedFields: string[];
  takeValue?: number;
};

function createSegmentQueryBuilderMock(resolveRows: (state: QueryState) => any[]) {
  const state: QueryState = { params: {}, selectedFields: [] };

  return {
    select(fields: string[]) {
      state.selectedFields = fields;
      return this;
    },
    where(_sql: string, params: Record<string, unknown>) {
      Object.assign(state.params, params);
      return this;
    },
    andWhere(_sql: string, params: Record<string, unknown>) {
      Object.assign(state.params, params);
      return this;
    },
    orderBy() {
      return this;
    },
    take(value: number) {
      state.takeValue = value;
      return this;
    },
    async getMany() {
      return resolveRows(state);
    },
  };
}

describe('SegmentIndexer.reindex', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pages through all segments without using Segment.find()', async () => {
    const pages = new Map<number, any[]>([
      [
        0,
        [
          { id: 1, mediaId: 10, contentJa: 'a' },
          { id: 2, mediaId: 10, contentJa: 'b' },
        ],
      ],
      [2, [{ id: 3, mediaId: 20, contentJa: 'c' }]],
      [3, []],
    ]);

    const findSpy = vi.spyOn(Segment, 'find');
    const createQueryBuilderSpy = vi.spyOn(Segment, 'createQueryBuilder').mockImplementation(() => {
      return createSegmentQueryBuilderMock((state) => {
        expect(state.selectedFields).toContain('segment.posAnalysis');
        expect(state.selectedFields).not.toContain('segment.ratingAnalysis');
        expect(state.takeValue).toBe(500);
        return pages.get(Number(state.params.lastId ?? 0)) ?? [];
      }) as any;
    });
    const bulkIndexSpy = vi.spyOn(SegmentIndexer, 'bulkIndex').mockImplementation(async (segments) => ({
      succeeded: segments.length,
      failed: 0,
      errors: [],
    }));

    const result = await SegmentIndexer.reindex();

    expect(result).toEqual({
      success: true,
      message: 'Reindex operation completed',
      stats: {
        totalSegments: 3,
        successfulIndexes: 3,
        failedIndexes: 0,
        mediaProcessed: 2,
      },
      errors: [],
    });
    expect(findSpy).not.toHaveBeenCalled();
    expect(createQueryBuilderSpy).toHaveBeenCalledTimes(3);
    expect(bulkIndexSpy).toHaveBeenCalledTimes(2);
  });
});
