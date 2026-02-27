import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, spyOn } from 'bun:test';
import type { Application, Request, Response, NextFunction } from 'express';
import { buildApplication } from '@config/application';
import { AppDataSource } from '@config/database';
import { client as esClient } from '@config/elasticsearch';
import { AdminRoutes } from '@config/routes';
import { setBossInstance } from '@app/workers/pgBossClient';
import { AuthType, ApiKeyKind, ApiPermission } from '@app/models/ApiPermission';
import { User, UserRoleType } from '@app/models/User';
import { SegmentDocument } from '@app/models/SegmentDocument';
import { Cache } from '@lib/cache';
import { FIXTURE_SETS } from '../fixtures/catalog';

let app: Application;
let adminUser: User;
const activeSpies: Array<{ mockRestore: () => void }> = [];

function testAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  const user = req.app.locals.testUser;
  if (user) {
    req.user = user;
    req.auth = {
      type: AuthType.API_KEY,
      apiKey: {
        kind: ApiKeyKind.SERVICE,
        permissions: Object.values(ApiPermission),
      },
    };
  }
  next();
}

function signInAs(targetApp: Application, user: User | null) {
  targetApp.locals.testUser = user;
}

beforeAll(async () => {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const mockExecuteSql = async () => ({ rows: [{ count: 0 }] });
  setBossInstance({
    getQueueStats: async (_queue: string) => ({ queuedCount: 0, activeCount: 0 }),
    getDb: () => ({ executeSql: mockExecuteSql }),
  } as any);

  const kevinDef = FIXTURE_SETS.core.users.kevin;
  await User.upsert({ ...kevinDef, role: UserRoleType.ADMIN }, { conflictPaths: ['email'] });
  adminUser = await User.findOneByOrFail({ email: kevinDef.email as string });

  app = buildApplication({
    beforeRoutes: [testAuthMiddleware],
    mountRoutes: (appInstance) => {
      appInstance.use('/', AdminRoutes);
    },
  });
});

beforeEach(() => {
  signInAs(app, adminUser);
});

afterEach(() => {
  while (activeSpies.length > 0) {
    activeSpies.pop()?.mockRestore();
  }
});

afterAll(async () => {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
});

describe('GET /v1/admin/health', () => {
  it('returns 200 with status and service info', async () => {
    const res = await request(app).get('/v1/admin/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: expect.stringMatching(/^(healthy|degraded)$/),
      app: { version: expect.any(String) },
      elasticsearch: {
        status: expect.stringMatching(/^(connected|disconnected)$/),
      },
      database: {
        status: expect.stringMatching(/^(connected|disconnected)$/),
      },
    });
  });

  it('returns degraded with disconnected elasticsearch payload when ES checks fail', async () => {
    const infoSpy = spyOn(esClient, 'info').mockRejectedValueOnce(new Error('es down'));
    const healthSpy = spyOn(esClient.cluster, 'health').mockResolvedValueOnce({
      cluster_name: 'test-cluster',
      status: 'green',
    } as any);
    const countSpy = spyOn(esClient, 'count').mockResolvedValueOnce({ count: 10 } as any);

    activeSpies.push(infoSpy, healthSpy, countSpy);

    const res = await request(app).get('/v1/admin/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.elasticsearch).toEqual({
      status: 'disconnected',
      version: null,
      clusterName: null,
      clusterStatus: null,
      indexName: null,
      documentCount: null,
    });
  });

  it('returns degraded with disconnected database payload when DB check fails', async () => {
    const infoSpy = spyOn(esClient, 'info').mockResolvedValueOnce({ version: { number: '8.12.0' } } as any);
    const healthSpy = spyOn(esClient.cluster, 'health').mockResolvedValueOnce({
      cluster_name: 'test-cluster',
      status: 'green',
    } as any);
    const countSpy = spyOn(esClient, 'count').mockResolvedValueOnce({ count: 10 } as any);
    const querySpy = spyOn(AppDataSource, 'query').mockRejectedValueOnce(new Error('db down'));

    activeSpies.push(infoSpy, healthSpy, countSpy, querySpy);

    const res = await request(app).get('/v1/admin/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.database).toEqual({
      status: 'disconnected',
      version: null,
    });
  });

  it('normalizes postgres version when DB is connected', async () => {
    const infoSpy = spyOn(esClient, 'info').mockResolvedValueOnce({ version: { number: '8.12.0' } } as any);
    const healthSpy = spyOn(esClient.cluster, 'health').mockResolvedValueOnce({
      cluster_name: 'test-cluster',
      status: 'green',
    } as any);
    const countSpy = spyOn(esClient, 'count').mockResolvedValueOnce({ count: 10 } as any);
    const querySpy = spyOn(AppDataSource, 'query').mockResolvedValueOnce([
      {
        version:
          'PostgreSQL 16.4 (Debian 16.4-1.pgdg120+2) on x86_64-pc-linux-gnu, compiled by gcc (Debian 12.2.0-14) 12.2.0',
      },
    ]);

    activeSpies.push(infoSpy, healthSpy, countSpy, querySpy);

    const res = await request(app).get('/v1/admin/health');

    expect(res.status).toBe(200);
    expect(res.body.database).toEqual({
      status: 'connected',
      version: 'PostgreSQL 16.4',
    });
  });

  it('returns null database version when postgres version payload is empty', async () => {
    const infoSpy = spyOn(esClient, 'info').mockResolvedValueOnce({ version: { number: '8.12.0' } } as any);
    const healthSpy = spyOn(esClient.cluster, 'health').mockResolvedValueOnce({
      cluster_name: 'test-cluster',
      status: 'green',
    } as any);
    const countSpy = spyOn(esClient, 'count').mockResolvedValueOnce({ count: 10 } as any);
    const querySpy = spyOn(AppDataSource, 'query').mockResolvedValueOnce([{ version: '   ' }]);

    activeSpies.push(infoSpy, healthSpy, countSpy, querySpy);

    const res = await request(app).get('/v1/admin/health');

    expect(res.status).toBe(200);
    expect(res.body.database).toEqual({
      status: 'connected',
      version: null,
    });
  });
});

describe('GET /v1/admin/dashboard', () => {
  it('returns 200 with media, users, activity, and system stats', async () => {
    const res = await request(app).get('/v1/admin/dashboard');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      media: {
        totalMedia: expect.any(Number),
        totalEpisodes: expect.any(Number),
        totalSegments: expect.any(Number),
        totalCharacters: expect.any(Number),
        totalSeiyuu: expect.any(Number),
      },
      users: {
        totalUsers: expect.any(Number),
        recentlyRegisteredCount: expect.any(Number),
        recentlyActiveCount: expect.any(Number),
      },
      activity: {
        totalSearches: expect.any(Number),
        totalExports: expect.any(Number),
        totalPlays: expect.any(Number),
        activeSearchers7d: expect.any(Number),
        topQueries7d: expect.any(Array),
        dailyActivity30d: expect.any(Array),
      },
      system: {
        status: expect.stringMatching(/^(healthy|degraded)$/),
        app: { version: expect.any(String) },
        elasticsearch: expect.any(Object),
        database: expect.any(Object),
        queues: expect.any(Array),
      },
    });
  });

  it('returns non-negative user and media totals', async () => {
    const res = await request(app).get('/v1/admin/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.users.totalUsers).toBeGreaterThanOrEqual(0);
    expect(res.body.media.totalMedia).toBeGreaterThanOrEqual(0);
  });
});

describe('POST /v1/admin/reindex', () => {
  it('passes undefined media when body is empty and invalidates search stats cache', async () => {
    const reindexSpy = spyOn(SegmentDocument, 'reindex').mockResolvedValueOnce({
      success: true,
      message: 'Reindex operation completed',
      stats: {
        totalSegments: 0,
        successfulIndexes: 0,
        failedIndexes: 0,
        mediaProcessed: 0,
      },
      errors: [],
    });
    const invalidateSpy = spyOn(Cache, 'invalidate').mockReturnValue(undefined);

    activeSpies.push(reindexSpy, invalidateSpy);

    const res = await request(app).post('/v1/admin/reindex').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Reindex operation completed',
      stats: {
        totalSegments: 0,
        successfulIndexes: 0,
        failedIndexes: 0,
        mediaProcessed: 0,
      },
      errors: [],
    });
    expect(reindexSpy).toHaveBeenCalledWith(undefined);
    expect(invalidateSpy).toHaveBeenCalledWith(SegmentDocument.SEARCH_STATS_CACHE);
  });

  it('maps media payload before reindexing and returns 200', async () => {
    const reindexSpy = spyOn(SegmentDocument, 'reindex').mockResolvedValueOnce({
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
    const invalidateSpy = spyOn(Cache, 'invalidate').mockReturnValue(undefined);

    activeSpies.push(reindexSpy, invalidateSpy);

    const payload = {
      media: [{ mediaId: 99999, episodes: [1] }, { mediaId: 42 }],
    };

    const res = await request(app).post('/v1/admin/reindex').send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
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
    expect(reindexSpy).toHaveBeenCalledWith([
      { mediaId: 99999, episodes: [1] },
      { mediaId: 42, episodes: undefined },
    ]);
    expect(invalidateSpy).toHaveBeenCalledWith(SegmentDocument.SEARCH_STATS_CACHE);
  });
});
