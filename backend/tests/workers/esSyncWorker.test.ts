import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerEsSyncWorkers } from '@app/workers/esSyncWorker';
import { ES_SYNC_CREATE_QUEUE, ES_SYNC_DELETE_QUEUE, ES_SYNC_UPDATE_QUEUE } from '@app/workers/queueNames';

/**
 * The workers that keep Elasticsearch in step with Postgres.
 *
 * What is worth testing here is exactly one decision, made twice: WHEN TO
 * THROW. These handlers run under pg-boss, where a throw fails the whole batch
 * and schedules a retry, and returning normally marks all hundred jobs done.
 * So the choice is between losing documents and retrying forever, and both
 * failure modes are silent:
 *
 * - Throwing when only SOME documents failed retries the ninety-nine that
 *   already landed, re-indexing them on every attempt.
 * - Not throwing when ALL of them failed marks a batch complete that wrote
 *   nothing, and the segments are missing from search with no job left to
 *   notice.
 *
 * The other case is a segment deleted between being enqueued and being
 * processed. That is ordinary -- the delete job is in a different queue -- and
 * it must not fail the batch, or the queue jams behind a row that is never
 * coming back.
 */
const bulkIndex = vi.fn();
const bulkDelete = vi.fn();
vi.mock('@app/services/search/segmentDocument/SegmentIndexer', () => ({
  SegmentIndexer: {
    bulkIndex: (...a: unknown[]) => bulkIndex(...a),
    bulkDelete: (...a: unknown[]) => bulkDelete(...a),
  },
}));

const segmentFind = vi.fn();
vi.mock('@app/models', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@app/models')>();
  return { ...actual, Segment: { ...actual.Segment, find: (...a: unknown[]) => segmentFind(...a) } };
});

const logWarn = vi.fn();
const logError = vi.fn();
vi.mock('@config/log', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@config/log')>();
  return {
    ...actual,
    logger: { ...actual.logger, warn: (...a: unknown[]) => logWarn(...a), error: (...a: unknown[]) => logError(...a) },
  };
});

// The instrumentation wrapper has its own tests; here it must pass the handler
// through, or every assertion below would pass against a handler never run.
vi.mock('@app/workers/workerInstrumentation', () => ({
  instrumentedHandler: (_queue: string, handler: unknown) => handler,
}));

type JobHandler = (jobs: unknown[]) => Promise<void>;

/** A pg-boss double that records the handler registered per queue. */
function fakeBoss() {
  const handlers = new Map<string, JobHandler>();
  const work = vi.fn(async (queue: string, _opts: unknown, handler: JobHandler) => {
    handlers.set(queue, handler);
  });
  return {
    boss: { work } as never,
    work,
    handlers,
    run: (queue: string, segmentIds: number[]) =>
      handlers.get(queue)!(segmentIds.map((segmentId, i) => ({ id: `job-${i}`, name: queue, data: { segmentId } }))),
  };
}

/** Segments as `Segment.find` would return them. */
function found(ids: number[]) {
  return ids.map((id) => ({ id }));
}

beforeEach(() => {
  vi.clearAllMocks();
  segmentFind.mockResolvedValue([]);
  bulkIndex.mockResolvedValue({ succeeded: 0, failed: 0, errors: [] });
  bulkDelete.mockResolvedValue({ succeeded: 0, failed: 0, errors: [] });
});

describe('registration', () => {
  it('registers a worker on each of the three queues', async () => {
    const { boss, handlers } = fakeBoss();

    await registerEsSyncWorkers(boss);

    expect([...handlers.keys()].sort()).toEqual(
      [ES_SYNC_CREATE_QUEUE, ES_SYNC_DELETE_QUEUE, ES_SYNC_UPDATE_QUEUE].sort(),
    );
  });

  it('batches, rather than taking one segment per job', async () => {
    // A bulk request per segment would be one round trip each for a backfill
    // that enqueues hundreds of thousands.
    const { boss, work } = fakeBoss();

    await registerEsSyncWorkers(boss);

    expect(work.mock.calls[0]![1]).toMatchObject({ batchSize: 100 });
  });
});

describe.each([
  ['create', ES_SYNC_CREATE_QUEUE],
  ['update', ES_SYNC_UPDATE_QUEUE],
])('the %s worker', (_name, queue) => {
  it('indexes the segments the batch named', async () => {
    const { boss, run } = fakeBoss();
    await registerEsSyncWorkers(boss);
    segmentFind.mockResolvedValue(found([1, 2]));
    bulkIndex.mockResolvedValue({ succeeded: 2, failed: 0, errors: [] });

    await run(queue, [1, 2]);

    expect(bulkIndex).toHaveBeenCalledWith(found([1, 2]));
  });

  it('completes the batch when every document landed', async () => {
    const { boss, run } = fakeBoss();
    await registerEsSyncWorkers(boss);
    segmentFind.mockResolvedValue(found([1]));
    bulkIndex.mockResolvedValue({ succeeded: 1, failed: 0, errors: [] });

    await expect(run(queue, [1])).resolves.toBeUndefined();
  });

  it('does NOT retry the batch when only some documents failed', async () => {
    // Retrying would re-index the ninety-nine that already landed on every
    // attempt, and the one that is genuinely broken would still be broken.
    const { boss, run } = fakeBoss();
    await registerEsSyncWorkers(boss);
    segmentFind.mockResolvedValue(found([1, 2]));
    bulkIndex.mockResolvedValue({ succeeded: 1, failed: 1, errors: [{ segmentId: 2, error: 'bad field' }] });

    await expect(run(queue, [1, 2])).resolves.toBeUndefined();
  });

  it('names each failed document, so a partial failure is not silent', async () => {
    const { boss, run } = fakeBoss();
    await registerEsSyncWorkers(boss);
    segmentFind.mockResolvedValue(found([1, 2]));
    bulkIndex.mockResolvedValue({ succeeded: 1, failed: 1, errors: [{ segmentId: 2, error: 'bad field' }] });

    await run(queue, [1, 2]);

    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({ segmentId: 2, error: 'bad field' }),
      expect.any(String),
    );
  });

  it('DOES retry when every document failed', async () => {
    // Completing here would mark a batch done that wrote nothing, and the
    // segments would be missing from search with no job left to notice.
    const { boss, run } = fakeBoss();
    await registerEsSyncWorkers(boss);
    segmentFind.mockResolvedValue(found([1, 2]));
    bulkIndex.mockResolvedValue({ succeeded: 0, failed: 2, errors: [] });

    await expect(run(queue, [1, 2])).rejects.toThrow(/All 2 segments failed/);
  });

  it('retries when the index is unreachable', async () => {
    const { boss, run } = fakeBoss();
    await registerEsSyncWorkers(boss);
    segmentFind.mockResolvedValue(found([1]));
    bulkIndex.mockRejectedValue(new Error('connection refused'));

    await expect(run(queue, [1])).rejects.toThrow('connection refused');
  });

  it('completes a batch whose segments have all been deleted since', async () => {
    // Ordinary: the delete job is in a different queue and may land first.
    // Throwing would jam this queue behind rows that are never coming back.
    const { boss, run } = fakeBoss();
    await registerEsSyncWorkers(boss);
    segmentFind.mockResolvedValue([]);

    await expect(run(queue, [1, 2])).resolves.toBeUndefined();
    expect(bulkIndex).not.toHaveBeenCalled();
  });

  it('indexes the segments that DO still exist, and says which did not', async () => {
    const { boss, run } = fakeBoss();
    await registerEsSyncWorkers(boss);
    segmentFind.mockResolvedValue(found([1]));
    bulkIndex.mockResolvedValue({ succeeded: 1, failed: 0, errors: [] });

    await run(queue, [1, 2]);

    expect(bulkIndex).toHaveBeenCalledWith(found([1]));
    expect(logWarn).toHaveBeenCalledWith(expect.objectContaining({ missingIds: [2] }), expect.any(String));
  });

  it('retries when the database itself is unreachable', async () => {
    // Distinct from "the segments are gone": nothing was established, so
    // completing the batch would drop the work.
    const { boss, run } = fakeBoss();
    await registerEsSyncWorkers(boss);
    segmentFind.mockRejectedValue(new Error('connection terminated'));

    await expect(run(queue, [1])).rejects.toThrow('connection terminated');
  });
});

describe('the delete worker', () => {
  it('removes the segments the batch named', async () => {
    const { boss, run } = fakeBoss();
    await registerEsSyncWorkers(boss);
    bulkDelete.mockResolvedValue({ succeeded: 2, failed: 0, errors: [] });

    await run(ES_SYNC_DELETE_QUEUE, [1, 2]);

    expect(bulkDelete).toHaveBeenCalledWith([1, 2]);
  });

  it('does not look the segments up first -- they are gone by definition', async () => {
    // The row is already deleted; reading it back would find nothing and there
    // is nothing in it the index needs anyway.
    const { boss, run } = fakeBoss();
    await registerEsSyncWorkers(boss);
    bulkDelete.mockResolvedValue({ succeeded: 1, failed: 0, errors: [] });

    await run(ES_SYNC_DELETE_QUEUE, [1]);

    expect(segmentFind).not.toHaveBeenCalled();
  });

  it('does not retry a partial failure', async () => {
    const { boss, run } = fakeBoss();
    await registerEsSyncWorkers(boss);
    bulkDelete.mockResolvedValue({ succeeded: 1, failed: 1, errors: [{ segmentId: 2, error: 'nope' }] });

    await expect(run(ES_SYNC_DELETE_QUEUE, [1, 2])).resolves.toBeUndefined();
    expect(logWarn).toHaveBeenCalledWith(expect.objectContaining({ segmentId: 2 }), expect.any(String));
  });

  it('retries when every delete failed', async () => {
    const { boss, run } = fakeBoss();
    await registerEsSyncWorkers(boss);
    bulkDelete.mockResolvedValue({ succeeded: 0, failed: 2, errors: [] });

    await expect(run(ES_SYNC_DELETE_QUEUE, [1, 2])).rejects.toThrow(/All 2 segments failed/);
  });

  it('completes an empty result rather than reading it as total failure', async () => {
    // `succeeded === 0 && failed > 0` is the throw condition, so zero of both
    // -- an empty batch -- has to fall through.
    const { boss, run } = fakeBoss();
    await registerEsSyncWorkers(boss);

    await expect(run(ES_SYNC_DELETE_QUEUE, [])).resolves.toBeUndefined();
  });

  it('retries when the index is unreachable', async () => {
    const { boss, run } = fakeBoss();
    await registerEsSyncWorkers(boss);
    bulkDelete.mockRejectedValue(new Error('connection refused'));

    await expect(run(ES_SYNC_DELETE_QUEUE, [1])).rejects.toThrow('connection refused');
    expect(logError).toHaveBeenCalled();
  });
});
