import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setBossInstance } from '@app/workers/pgBossClient';
import { sendBulkTokenParseJobs, sendTokenParseJob } from '@app/workers/tokenParseQueue';
import { TOKEN_PARSE_QUEUE } from '@app/workers/queueNames';

describe('tokenParseQueue', () => {
  let sendDebounced: ReturnType<typeof vi.fn>;
  let insert: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendDebounced = vi.fn().mockResolvedValue('job-id');
    insert = vi.fn().mockResolvedValue(['bulk-job-id']);

    setBossInstance({ sendDebounced, insert } as any);
  });

  it('debounces a single parse on the segment id', async () => {
    await sendTokenParseJob(42);

    expect(sendDebounced).toHaveBeenCalledWith(TOKEN_PARSE_QUEUE, { segmentId: 42 }, null, 1, '42');
  });

  it('enqueues one job per segment, each carrying its own id and singleton key', async () => {
    // Two properties at once. `send(queue, jobs)` would store the array as one
    // job's payload and the worker reads a pull as one job per segment -- the
    // mistake the ES sync queue had to learn. And the singleton key is what lets
    // this collapse against `sendTokenParseJob`, so a line reaching both
    // producers is parsed once rather than twice.
    await sendBulkTokenParseJobs([7, 8, 9]);

    expect(insert).toHaveBeenCalledWith(TOKEN_PARSE_QUEUE, [
      { data: { segmentId: 7 }, singletonKey: '7' },
      { data: { segmentId: 8 }, singletonKey: '8' },
      { data: { segmentId: 9 }, singletonKey: '9' },
    ]);
  });

  it('splits a sweep-sized batch across statements rather than one huge insert', async () => {
    // pg-boss builds one statement per call, so an unchunked sweep would hand
    // Postgres a single INSERT carrying twenty thousand rows of JSON.
    await sendBulkTokenParseJobs(Array.from({ length: 4_500 }, (_, index) => index + 1));

    expect(insert).toHaveBeenCalledTimes(3);
    const sent = insert.mock.calls.flatMap(([, jobs]: any[]) => jobs.map((job: any) => job.data.segmentId));
    expect(sent).toHaveLength(4_500);
    expect(new Set(sent).size).toBe(4_500);
  });

  it('does not enqueue an empty batch', async () => {
    await sendBulkTokenParseJobs([]);

    expect(insert).not.toHaveBeenCalled();
  });

  it('swallows an enqueue failure rather than failing the write that asked', async () => {
    // The caller has already committed its rows. A segment with no tokens is
    // degraded, not broken, and the nightly sweep picks it up.
    insert.mockRejectedValue(new Error('pg-boss is down'));

    await expect(sendBulkTokenParseJobs([1])).resolves.toBeUndefined();
  });
});
