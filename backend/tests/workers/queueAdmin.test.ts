import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { setBossInstance } from '@app/workers/pgBossClient';
import { fetchQueueDetails, getFailedJobs, getStuckJobs, purgeFailedJobs, retryFailedJobs } from '@app/workers/queueAdmin';
import { ES_SYNC_QUEUES } from '@app/workers/queueNames';

describe('queueAdmin', () => {
  let getQueueStats: ReturnType<typeof vi.fn>;
  let executeSql: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getQueueStats = vi.fn().mockResolvedValue({
      deferredCount: 1,
      queuedCount: 2,
      activeCount: 3,
      totalCount: 6,
      policy: 'standard',
      partition: false,
      deadLetter: null,
      warningQueueSize: null,
      retryLimit: 5,
      retryDelay: 1000,
      retryBackoff: true,
      retryDelayMax: 10000,
      expireInSeconds: 3600,
      retentionSeconds: 86400,
      deleteAfterSeconds: null,
      createdOn: new Date('2026-02-01T00:00:00.000Z'),
      updatedOn: new Date('2026-02-01T01:00:00.000Z'),
      singletonsActive: [],
      table: 'pgboss.job',
    });

    executeSql = vi.fn().mockResolvedValue({ rows: [] });

    setBossInstance({
      getQueueStats,
      getDb: () => ({ executeSql }),
    } as any);
  });

  it('returns stuck-job stats for all ES sync queues', async () => {
    const stats = await getStuckJobs();

    expect(getQueueStats).toHaveBeenCalledTimes(ES_SYNC_QUEUES.length);
    expect(stats).toEqual([
      { queue: 'es-sync-create', stuckCount: 5, failedCount: 0 },
      { queue: 'es-sync-update', stuckCount: 5, failedCount: 0 },
      { queue: 'es-sync-delete', stuckCount: 5, failedCount: 0 },
    ]);
  });

  it('returns mapped queue details with ISO timestamps', async () => {
    const details = await fetchQueueDetails('es-sync-create');

    expect(details).toMatchObject({
      queue: 'es-sync-create',
      stats: {
        deferred: 1,
        queued: 2,
        active: 3,
        total: 6,
      },
      metadata: {
        table: 'pgboss.job',
        createdOn: '2026-02-01T00:00:00.000Z',
        updatedOn: '2026-02-01T01:00:00.000Z',
      },
    });
  });

  it('returns failed jobs from the pgboss table', async () => {
    executeSql.mockResolvedValueOnce({
      rows: [{ id: 'job-1', segmentId: 42, error: 'boom', createdOn: new Date('2026-02-02T03:04:05.000Z') }],
    });

    const rows = await getFailedJobs('es-sync-update');

    expect(executeSql).toHaveBeenCalledTimes(1);
    expect(rows).toEqual([{ id: 'job-1', segmentId: 42, error: 'boom', createdOn: new Date('2026-02-02T03:04:05.000Z') }]);
  });

  it('returns the number of purged failed jobs', async () => {
    executeSql.mockResolvedValueOnce({ rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });

    await expect(purgeFailedJobs('es-sync-delete')).resolves.toBe(3);
  });

  it('returns zero for retry requests (pg-boss managed retries)', async () => {
    await expect(retryFailedJobs('es-sync-create')).resolves.toBe(0);
  });
});
