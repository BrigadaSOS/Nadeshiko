import { describe, expect, it } from 'bun:test';
import {
  toAdminQueueDetailsDTO,
  toAdminQueueFailedJobDTO,
  toAdminQueueFailedJobsDTO,
  toAdminQueuePurgeResultDTO,
  toAdminQueueRetryResultDTO,
  toAdminQueueStatsDTO,
} from '@app/controllers/mappers/queue.mapper';

describe('queue.mapper', () => {
  it('maps queue stats list', () => {
    const stats = toAdminQueueStatsDTO([
      { queue: 'es-sync-create', stuckCount: 2, failedCount: 0 },
      { queue: 'es-sync-update', stuckCount: 4, failedCount: 1 },
    ] as any);

    expect(stats).toEqual([
      { queue: 'es-sync-create', stuckCount: 2, failedCount: 0 },
      { queue: 'es-sync-update', stuckCount: 4, failedCount: 1 },
    ]);
  });

  it('maps queue details payload', () => {
    const dto = toAdminQueueDetailsDTO({
      queue: 'es-sync-create',
      stats: { deferred: 1, queued: 2, active: 3, total: 6 },
      metadata: {
        policy: 'standard',
        partition: false,
        deadLetter: null,
        warningQueueSize: null,
        retryLimit: 3,
        retryDelay: 5,
        retryBackoff: true,
        retryDelayMax: 10,
        expireInSeconds: null,
        retentionSeconds: null,
        deleteAfterSeconds: null,
        createdOn: '2026-01-01T00:00:00.000Z',
        updatedOn: '2026-01-02T00:00:00.000Z',
        singletonsActive: [],
        table: 'pgboss.job',
      },
    } as any);

    expect(dto.queue).toBe('es-sync-create');
    expect(dto.stats).toEqual({ deferred: 1, queued: 2, active: 3, total: 6 });
    expect(dto.metadata.policy).toBe('standard');
    expect(dto.metadata.table).toBe('pgboss.job');
  });

  it('maps a failed job with ISO timestamp', () => {
    const dto = toAdminQueueFailedJobDTO({
      id: 'job-1',
      segmentId: 99,
      error: 'boom',
      createdOn: new Date('2026-01-03T04:05:06.000Z'),
    } as any);

    expect(dto).toEqual({
      id: 'job-1',
      segmentId: 99,
      error: 'boom',
      createdOn: '2026-01-03T04:05:06.000Z',
    });
  });

  it('maps failed jobs list', () => {
    const list = toAdminQueueFailedJobsDTO([
      { id: 'a', segmentId: 1, error: null, createdOn: new Date('2026-01-01T00:00:00.000Z') },
      { id: 'b', segmentId: 2, error: 'bad', createdOn: new Date('2026-01-02T00:00:00.000Z') },
    ] as any);

    expect(list).toHaveLength(2);
    expect(list[0].createdOn).toBe('2026-01-01T00:00:00.000Z');
    expect(list[1].createdOn).toBe('2026-01-02T00:00:00.000Z');
  });

  it('maps retry and purge action responses', () => {
    expect(toAdminQueueRetryResultDTO('es-sync-create', 5)).toEqual({
      success: true,
      retriedCount: 5,
      message: 'Retried 5 failed jobs from es-sync-create',
    });

    expect(toAdminQueuePurgeResultDTO('es-sync-update', 3)).toEqual({
      success: true,
      purgedCount: 3,
      message: 'Purged 3 failed jobs from es-sync-update',
    });
  });
});
