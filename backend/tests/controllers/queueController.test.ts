import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'bun:test';
import type { Application, Request, Response, NextFunction } from 'express';
import { buildApplication } from '@config/application';
import { AdminRoutes } from '@config/routes';
import { ApiKeyKind, ApiPermission, AuthType } from '@app/models/ApiPermission';
import { setBossInstance } from '@app/workers/pgBossClient';

let app: Application;
let mockGetQueueStats: ReturnType<typeof vi.fn>;
let mockExecuteSql: ReturnType<typeof vi.fn>;

function testAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  req.auth = {
    type: AuthType.API_KEY,
    apiKey: {
      kind: ApiKeyKind.SERVICE,
      permissions: Object.values(ApiPermission),
    },
  };
  next();
}

beforeAll(() => {
  app = buildApplication({
    beforeRoutes: [testAuthMiddleware],
    mountRoutes: (instance) => {
      instance.use('/', AdminRoutes);
    },
  });
});

beforeEach(() => {
  mockGetQueueStats = vi.fn();
  mockExecuteSql = vi.fn().mockResolvedValue({ rows: [] });

  setBossInstance({
    getQueueStats: mockGetQueueStats,
    getDb: () => ({ executeSql: mockExecuteSql }),
  } as any);
});

describe('GET /v1/admin/queues/stats', () => {
  it('returns queue stats from queue admin module', async () => {
    mockGetQueueStats.mockResolvedValue({
      deferredCount: 0,
      queuedCount: 2,
      activeCount: 0,
      totalCount: 2,
    });

    const res = await request(app).get('/v1/admin/queues/stats');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { queue: 'es-sync-create', stuckCount: 2, failedCount: 0 },
      { queue: 'es-sync-update', stuckCount: 2, failedCount: 0 },
      { queue: 'es-sync-delete', stuckCount: 2, failedCount: 0 },
      { queue: 'email-send', stuckCount: 2, failedCount: 0 },
      { queue: 'activity-retention-cleanup', stuckCount: 2, failedCount: 0 },
    ]);
    expect(mockGetQueueStats).toHaveBeenCalledTimes(5);
  });
});

describe('GET /v1/admin/queues/:queueName', () => {
  it('returns queue details when queue exists', async () => {
    mockGetQueueStats.mockResolvedValue({
      deferredCount: 1,
      queuedCount: 2,
      activeCount: 3,
      totalCount: 6,
      policy: 'standard',
      partition: false,
      deadLetter: null,
      warningQueueSize: null,
      retryLimit: null,
      retryDelay: null,
      retryBackoff: null,
      retryDelayMax: null,
      expireInSeconds: null,
      retentionSeconds: null,
      deleteAfterSeconds: null,
      createdOn: new Date('2026-02-01T00:00:00.000Z'),
      updatedOn: new Date('2026-02-01T00:00:00.000Z'),
      singletonsActive: [],
      table: 'pgboss.job',
    });

    const res = await request(app).get('/v1/admin/queues/es-sync-create');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      queue: 'es-sync-create',
      stats: { deferred: 1, queued: 2, active: 3, total: 6 },
      metadata: { table: 'pgboss.job' },
    });
    expect(mockGetQueueStats).toHaveBeenCalledWith('es-sync-create');
  });

  it('returns 404 when queue details are not found', async () => {
    mockGetQueueStats.mockRejectedValue(new Error('Queue not found'));

    const res = await request(app).get('/v1/admin/queues/es-sync-delete');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      detail: 'Queue es-sync-delete not found or could not be retrieved',
    });
  });

  it('returns 400 for unsupported queue names', async () => {
    const res = await request(app).get('/v1/admin/queues/not-a-supported-queue');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
    expect(mockGetQueueStats).not.toHaveBeenCalled();
  });
});

describe('GET /v1/admin/queues/:queueName/failed', () => {
  it('returns failed jobs with ISO timestamps', async () => {
    mockExecuteSql.mockResolvedValue({
      rows: [
        {
          id: 'job-1',
          segmentId: 123,
          error: 'boom',
          createdOn: new Date('2026-02-02T03:04:05.000Z'),
        },
      ],
    });

    const res = await request(app).get('/v1/admin/queues/es-sync-create/failed');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: 'job-1',
        segmentId: 123,
        error: 'boom',
        createdOn: '2026-02-02T03:04:05.000Z',
      },
    ]);
    expect(mockExecuteSql).toHaveBeenCalledTimes(1);
  });
});

describe('POST /v1/admin/queues/:queueName/retry', () => {
  it('returns retry summary payload', async () => {
    const res = await request(app).post('/v1/admin/queues/es-sync-update/retry');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      retriedCount: 0,
      message: 'Retried 0 failed jobs from es-sync-update',
    });
  });
});

describe('DELETE /v1/admin/queues/:queueName/purge', () => {
  it('returns purge summary payload', async () => {
    mockExecuteSql.mockResolvedValue({
      rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
    });

    const res = await request(app).delete('/v1/admin/queues/es-sync-delete/purge');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      purgedCount: 4,
      message: 'Purged 4 failed jobs from es-sync-delete',
    });
    expect(mockExecuteSql).toHaveBeenCalledTimes(1);
  });
});
