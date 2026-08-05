import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setBossInstance } from '@app/workers/pgBossClient';
import { sendBulkEsSyncJobs, sendEsSyncJob, type EsSyncJobData } from '@app/workers/esSyncQueue';
import { ES_SYNC_CREATE_QUEUE, ES_SYNC_DELETE_QUEUE, ES_SYNC_UPDATE_QUEUE } from '@app/workers/queueNames';

describe('esSyncQueue', () => {
  let sendDebounced: ReturnType<typeof vi.fn>;
  let insert: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendDebounced = vi.fn().mockResolvedValue('job-id');
    insert = vi.fn().mockResolvedValue(['bulk-job-id']);

    setBossInstance({
      sendDebounced,
      insert,
    } as any);
  });

  it('enqueues CREATE/UPDATE/DELETE jobs to their expected queues with debounce key', async () => {
    await sendEsSyncJob({ segmentId: 11, operation: 'CREATE' });
    await sendEsSyncJob({ segmentId: 12, operation: 'UPDATE' });
    await sendEsSyncJob({ segmentId: 13, operation: 'DELETE' });

    expect(sendDebounced).toHaveBeenCalledTimes(3);
    expect(sendDebounced).toHaveBeenNthCalledWith(
      1,
      ES_SYNC_CREATE_QUEUE,
      { segmentId: 11, operation: 'CREATE' },
      null,
      1,
      '11',
    );
    expect(sendDebounced).toHaveBeenNthCalledWith(
      2,
      ES_SYNC_UPDATE_QUEUE,
      { segmentId: 12, operation: 'UPDATE' },
      null,
      1,
      '12',
    );
    expect(sendDebounced).toHaveBeenNthCalledWith(
      3,
      ES_SYNC_DELETE_QUEUE,
      { segmentId: 13, operation: 'DELETE' },
      null,
      1,
      '13',
    );
  });

  it('batches jobs by queue for bulk insert', async () => {
    await sendBulkEsSyncJobs([
      { segmentId: 1, operation: 'CREATE' },
      { segmentId: 2, operation: 'UPDATE' },
      { segmentId: 3, operation: 'CREATE' },
    ]);

    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenCalledWith(ES_SYNC_CREATE_QUEUE, [
      { data: { segmentId: 1, operation: 'CREATE' } },
      { data: { segmentId: 3, operation: 'CREATE' } },
    ]);
    expect(insert).toHaveBeenCalledWith(ES_SYNC_UPDATE_QUEUE, [{ data: { segmentId: 2, operation: 'UPDATE' } }]);
  });

  it('enqueues one job per segment, each with its own readable segmentId', async () => {
    // This is the property that broke silently: `send(queue, jobs)` stores the
    // array as one job's payload, so the workers — which read a batch as
    // `jobs.map((j) => j.data.segmentId)` — got a list of undefined and indexed
    // nothing, without an error anywhere.
    const segmentIds = [10, 11, 12];

    await sendBulkEsSyncJobs(segmentIds.map((segmentId) => ({ segmentId, operation: 'DELETE' as const })));

    expect(insert).toHaveBeenCalledTimes(1);
    const [queueName, jobs] = insert.mock.calls[0] as [string, { data: EsSyncJobData }[]];
    expect(queueName).toBe(ES_SYNC_DELETE_QUEUE);
    expect(jobs.map((job) => job.data.segmentId)).toEqual(segmentIds);
  });
});
