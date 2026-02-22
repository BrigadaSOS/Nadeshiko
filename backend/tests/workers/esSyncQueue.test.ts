import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { setBossInstance } from '@app/workers/pgBossClient';
import { cancelJobsForSegment, sendBulkEsSyncJobs, sendEsSyncJob } from '@app/workers/esSyncQueue';
import { ES_SYNC_CREATE_QUEUE, ES_SYNC_DELETE_QUEUE, ES_SYNC_UPDATE_QUEUE } from '@app/workers/queueNames';

describe('esSyncQueue', () => {
  let sendDebounced: ReturnType<typeof vi.fn>;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendDebounced = vi.fn().mockResolvedValue('job-id');
    send = vi.fn().mockResolvedValue('bulk-job-id');

    setBossInstance({
      sendDebounced,
      send,
    } as any);
  });

  it('enqueues CREATE/UPDATE/DELETE jobs to their expected queues with debounce key', async () => {
    await sendEsSyncJob({ segmentId: 11, operation: 'CREATE' });
    await sendEsSyncJob({ segmentId: 12, operation: 'UPDATE' });
    await sendEsSyncJob({ segmentId: 13, operation: 'DELETE' });

    expect(sendDebounced).toHaveBeenCalledTimes(3);
    expect(sendDebounced).toHaveBeenNthCalledWith(1, ES_SYNC_CREATE_QUEUE, { segmentId: 11, operation: 'CREATE' }, null, 1, '11');
    expect(sendDebounced).toHaveBeenNthCalledWith(2, ES_SYNC_UPDATE_QUEUE, { segmentId: 12, operation: 'UPDATE' }, null, 1, '12');
    expect(sendDebounced).toHaveBeenNthCalledWith(3, ES_SYNC_DELETE_QUEUE, { segmentId: 13, operation: 'DELETE' }, null, 1, '13');
  });

  it('batches jobs by queue for bulk send', async () => {
    await sendBulkEsSyncJobs([
      { segmentId: 1, operation: 'CREATE' },
      { segmentId: 2, operation: 'UPDATE' },
      { segmentId: 3, operation: 'CREATE' },
    ]);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(ES_SYNC_CREATE_QUEUE, [
      { segmentId: 1, operation: 'CREATE' },
      { segmentId: 3, operation: 'CREATE' },
    ]);
    expect(send).toHaveBeenCalledWith(ES_SYNC_UPDATE_QUEUE, [{ segmentId: 2, operation: 'UPDATE' }]);
  });

  it('returns true for cancel request (debounce-based behavior)', async () => {
    await expect(cancelJobsForSegment(999)).resolves.toBe(true);
  });
});
