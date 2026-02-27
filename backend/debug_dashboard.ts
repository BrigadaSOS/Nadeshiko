import { buildApplication } from '@config/application';
import { AdminRoutes } from '@config/routes';
import request from 'supertest';
import { AppDataSource } from '@config/database';
import { setBossInstance } from '@app/workers/pgBossClient';
import { ApiKeyKind, ApiPermission, AuthType } from '@app/models/ApiPermission';
import type { Request, Response, NextFunction } from 'express';

await AppDataSource.initialize();
setBossInstance({
  getQueueStats: async () => ({ queuedCount: 0, activeCount: 0 }),
  getDb: () => ({ executeSql: async () => ({ rows: [{ count: 0 }] }) }),
} as any);

function testAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  req.auth = { type: AuthType.API_KEY, apiKey: { kind: ApiKeyKind.SERVICE, permissions: Object.values(ApiPermission) } };
  next();
}

const app = buildApplication({
  beforeRoutes: [testAuthMiddleware],
  mountRoutes: (a) => a.use('/', AdminRoutes),
});
const res = await request(app).get('/v1/admin/dashboard');
console.log('STATUS:', res.status);
console.log('BODY:', JSON.stringify(res.body, null, 2));
await AppDataSource.destroy();
