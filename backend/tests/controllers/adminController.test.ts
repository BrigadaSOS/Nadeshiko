import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, spyOn } from 'bun:test';
import type { Application, Request, Response, NextFunction } from 'express';
import { buildApplication } from '@config/application';
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
