import 'dotenv/config';
import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi, type Mock } from 'bun:test';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { invalidateUserCache, invalidateApiKeyCacheForUser } from '@app/middleware/authCacheStore';
import { auth } from '@config/auth';
import { buildApplication } from '@config/application';
import { router } from '@config/routes';

let mockGetSession: Mock<any>;
let mockVerifyApiKey: Mock<any>;

beforeAll(() => {
  mockGetSession = vi.spyOn(auth.api, 'getSession') as any;
  mockVerifyApiKey = vi.spyOn(auth.api as any, 'verifyApiKey') as any;
});

afterAll(() => {
  mockGetSession.mockRestore();
  mockVerifyApiKey.mockRestore();
});

setupTestSuite();

let fixtures: CoreFixtures;

beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue(null);
  mockVerifyApiKey.mockReset();
  invalidateUserCache(fixtures.users.kevin.id);
  invalidateUserCache(fixtures.users.regular.id);
  invalidateApiKeyCacheForUser(fixtures.users.kevin.id);
  invalidateApiKeyCacheForUser(fixtures.users.regular.id);
});

const app = createRouterTestApp();

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

interface RouteEntry {
  method: Method;
  path: string;
}

function sendRequest(method: Method, path: string) {
  const req = request(app)[method](path);
  if (method === 'post' || method === 'patch' || method === 'put') {
    return req.send({});
  }
  return req;
}

function sendAuthenticatedRequest(method: Method, path: string, token: string) {
  const req = request(app)[method](path).set('Authorization', `Bearer ${token}`);
  if (method === 'post' || method === 'patch' || method === 'put') {
    return req.send({});
  }
  return req;
}

const SESSION_ONLY_ROUTES: RouteEntry[] = [
  { method: 'post', path: '/v1/user/reports' },
  { method: 'get', path: '/v1/user/preferences' },
  { method: 'patch', path: '/v1/user/preferences' },
  { method: 'post', path: '/v1/user/activity' },
  { method: 'delete', path: '/v1/user/activity' },
  { method: 'delete', path: '/v1/user/activity/date/2025-01-01' },
  { method: 'delete', path: '/v1/user/activity/1' },
  { method: 'get', path: '/v1/user/export' },
  { method: 'get', path: '/v1/user/labs' },
  { method: 'post', path: '/v1/user/labs/test-key' },
  { method: 'delete', path: '/v1/user/labs/test-key' },
  { method: 'patch', path: '/v1/collections/V1StGXR8_Z5d' },
  { method: 'patch', path: '/v1/collections/V1StGXR8_Z5d/segments/V1StGXR8_Z5d' },
  { method: 'get', path: '/v1/collections/V1StGXR8_Z5d/stats' },
];

const ADMIN_SESSION_ROUTES: RouteEntry[] = [
  { method: 'post', path: '/v1/admin/reindex' },
  { method: 'get', path: '/v1/admin/reports' },
  { method: 'patch', path: '/v1/admin/reports/1' },
  { method: 'patch', path: '/v1/admin/reports/batch' },
  { method: 'put', path: '/v1/admin/announcement' },
  { method: 'get', path: '/v1/admin/media/audits' },
  { method: 'patch', path: '/v1/admin/media/audits/test-name' },
  { method: 'post', path: '/v1/admin/media/audits/test-name/run' },
  { method: 'get', path: '/v1/admin/media/audits/runs' },
  { method: 'get', path: '/v1/admin/media/audits/runs/1' },
];

const API_KEY_OR_SESSION_ROUTES: { method: Method; path: string; permission: string }[] = [
  { method: 'post', path: '/v1/search', permission: 'READ_MEDIA' },
  { method: 'post', path: '/v1/search/stats', permission: 'READ_MEDIA' },
  { method: 'post', path: '/v1/search/words', permission: 'READ_MEDIA' },
  { method: 'post', path: '/v1/search/media', permission: 'READ_MEDIA' },
  { method: 'get', path: '/v1/media', permission: 'READ_MEDIA' },
  { method: 'post', path: '/v1/media', permission: 'ADD_MEDIA' },
  { method: 'get', path: '/v1/media/V1StGXR8_Z5d', permission: 'READ_MEDIA' },
  { method: 'delete', path: '/v1/media/V1StGXR8_Z5d', permission: 'REMOVE_MEDIA' },
  { method: 'get', path: '/v1/media/V1StGXR8_Z5d/episodes', permission: 'READ_MEDIA' },
  { method: 'post', path: '/v1/media/V1StGXR8_Z5d/episodes', permission: 'ADD_MEDIA' },
  { method: 'get', path: '/v1/media/V1StGXR8_Z5d/episodes/1', permission: 'READ_MEDIA' },
  { method: 'patch', path: '/v1/media/V1StGXR8_Z5d/episodes/1', permission: 'UPDATE_MEDIA' },
  { method: 'delete', path: '/v1/media/V1StGXR8_Z5d/episodes/1', permission: 'REMOVE_MEDIA' },
  { method: 'get', path: '/v1/media/V1StGXR8_Z5d/episodes/1/segments', permission: 'READ_MEDIA' },
  { method: 'post', path: '/v1/media/V1StGXR8_Z5d/episodes/1/segments', permission: 'ADD_MEDIA' },
  { method: 'post', path: '/v1/media/V1StGXR8_Z5d/episodes/1/segments/batch', permission: 'ADD_MEDIA' },
  { method: 'get', path: '/v1/media/segments/V1StGXR8_Z5d', permission: 'READ_MEDIA' },
  { method: 'patch', path: '/v1/media/segments/V1StGXR8_Z5d', permission: 'UPDATE_MEDIA' },
  { method: 'get', path: '/v1/media/segments/V1StGXR8_Z5d/context', permission: 'READ_MEDIA' },
  { method: 'get', path: '/v1/media/segments/V1StGXR8_Z5d/revisions', permission: 'READ_MEDIA' },
  { method: 'patch', path: '/v1/media/V1StGXR8_Z5d', permission: 'UPDATE_MEDIA' },
  { method: 'get', path: '/v1/user/me', permission: 'READ_PROFILE' },
  { method: 'get', path: '/v1/user/excluded-media', permission: 'READ_PROFILE' },
  { method: 'post', path: '/v1/user/excluded-media', permission: 'WRITE_PROFILE' },
  { method: 'delete', path: '/v1/user/excluded-media/V1StGXR8_Z5d', permission: 'WRITE_PROFILE' },
  { method: 'get', path: '/v1/user/activity', permission: 'READ_ACTIVITY' },
  { method: 'get', path: '/v1/user/activity/heatmap', permission: 'READ_ACTIVITY' },
  { method: 'get', path: '/v1/user/activity/stats', permission: 'READ_ACTIVITY' },
  { method: 'get', path: '/v1/collections', permission: 'READ_COLLECTIONS' },
  { method: 'post', path: '/v1/collections', permission: 'CREATE_COLLECTIONS' },
  { method: 'get', path: '/v1/collections/V1StGXR8_Z5d', permission: 'READ_COLLECTIONS' },
  { method: 'delete', path: '/v1/collections/V1StGXR8_Z5d', permission: 'DELETE_COLLECTIONS' },
  { method: 'post', path: '/v1/collections/V1StGXR8_Z5d/segments', permission: 'UPDATE_COLLECTIONS' },
  { method: 'post', path: '/v1/collections/V1StGXR8_Z5d/search', permission: 'READ_COLLECTIONS' },
  { method: 'delete', path: '/v1/collections/V1StGXR8_Z5d/segments/V1StGXR8_Z5d', permission: 'DELETE_COLLECTIONS' },
];

const ADMIN_API_KEY_OR_ADMIN_SESSION_ROUTES: { method: Method; path: string; permission: string }[] = [];

describe('route auth wiring', () => {
  describe('session-only routes (requireSession)', () => {
    for (const route of SESSION_ONLY_ROUTES) {
      describe(`${route.method.toUpperCase()} ${route.path}`, () => {
        it('rejects unauthenticated requests with 401', async () => {
          const res = await sendRequest(route.method, route.path);
          expect(res.status).toBe(401);
        });

        it('rejects API key auth with 401', async () => {
          const token = mockBetterAuthApiKey(fixtures.users.kevin.id, ['READ_MEDIA']);
          const res = await sendAuthenticatedRequest(route.method, route.path, token);
          expect(res.status).toBe(401);
        });

        it('accepts session auth', async () => {
          mockSessionAuth(fixtures.users.regular.id);
          const res = await sendRequest(route.method, route.path);
          expect(res.status).not.toBe(401);
          expect(res.status).not.toBe(403);
        });
      });
    }
  });

  describe('admin session routes (requireSession + enforceAdminAccess)', () => {
    for (const route of ADMIN_SESSION_ROUTES) {
      describe(`${route.method.toUpperCase()} ${route.path}`, () => {
        it('rejects unauthenticated requests with 401', async () => {
          const res = await sendRequest(route.method, route.path);
          expect(res.status).toBe(401);
        });

        it('rejects API key auth with 401', async () => {
          const token = mockBetterAuthApiKey(fixtures.users.kevin.id, ['READ_MEDIA']);
          const res = await sendAuthenticatedRequest(route.method, route.path, token);
          expect(res.status).toBe(401);
        });

        it('rejects non-admin session with 403', async () => {
          mockSessionAuth(fixtures.users.regular.id);
          const res = await sendRequest(route.method, route.path);
          expect(res.status).toBe(403);
        });

        it('accepts admin session', async () => {
          mockSessionAuth(fixtures.users.kevin.id);
          const res = await sendRequest(route.method, route.path);
          expect(res.status).not.toBe(401);
          expect(res.status).not.toBe(403);
        });
      });
    }
  });

  describe('API key or session routes (requireAuth + enforceApiKeyScope)', () => {
    for (const route of API_KEY_OR_SESSION_ROUTES) {
      describe(`${route.method.toUpperCase()} ${route.path} [${route.permission}]`, () => {
        it('rejects unauthenticated requests with 401', async () => {
          const res = await sendRequest(route.method, route.path);
          expect(res.status).toBe(401);
        });

        it('rejects API key without required permission with 403', async () => {
          const wrongPermission = route.permission === 'READ_MEDIA' ? 'ADD_MEDIA' : 'READ_MEDIA';
          const token = mockBetterAuthApiKey(fixtures.users.kevin.id, [wrongPermission]);
          const res = await sendAuthenticatedRequest(route.method, route.path, token);
          expect(res.status).toBe(403);
        });

        it('accepts API key with required permission', async () => {
          const token = mockBetterAuthApiKey(fixtures.users.kevin.id, [route.permission]);
          const res = await sendAuthenticatedRequest(route.method, route.path, token);
          expect(res.status).not.toBe(401);
          expect(res.status).not.toBe(403);
        });

        it('accepts regular session auth (no permission check)', async () => {
          mockSessionAuth(fixtures.users.regular.id);
          const res = await sendRequest(route.method, route.path);
          expect(res.status).not.toBe(401);
          expect(res.status).not.toBe(403);
        });
      });
    }
  });

  describe('admin API key or admin session routes (requireAuth + enforceSessionAdmin + enforceApiKeyScope)', () => {
    for (const route of ADMIN_API_KEY_OR_ADMIN_SESSION_ROUTES) {
      describe(`${route.method.toUpperCase()} ${route.path} [${route.permission}]`, () => {
        it('rejects unauthenticated requests with 401', async () => {
          const res = await sendRequest(route.method, route.path);
          expect(res.status).toBe(401);
        });

        it('rejects non-admin session with 403', async () => {
          mockSessionAuth(fixtures.users.regular.id);
          const res = await sendRequest(route.method, route.path);
          expect(res.status).toBe(403);
        });

        it('accepts admin session', async () => {
          mockSessionAuth(fixtures.users.kevin.id);
          const res = await sendRequest(route.method, route.path);
          expect(res.status).not.toBe(401);
          expect(res.status).not.toBe(403);
        });

        it('rejects API key without required permission with 403', async () => {
          const token = mockBetterAuthApiKey(fixtures.users.kevin.id, ['READ_MEDIA']);
          const res = await sendAuthenticatedRequest(route.method, route.path, token);
          expect(res.status).toBe(403);
        });

        it('accepts API key with required permission', async () => {
          const token = mockBetterAuthApiKey(fixtures.users.kevin.id, [route.permission]);
          const res = await sendAuthenticatedRequest(route.method, route.path, token);
          expect(res.status).not.toBe(401);
          expect(res.status).not.toBe(403);
        });
      });
    }
  });

  describe('impersonation routes (local environment only, no auth)', () => {
    it('POST /v1/admin/impersonation allows unauthenticated in local env', async () => {
      const res = await request(app).post('/v1/admin/impersonation').send({ userId: 99999999 });
      expect(res.status).toBe(404);
    });

    it('DELETE /v1/admin/impersonation allows unauthenticated in local env', async () => {
      const res = await request(app).delete('/v1/admin/impersonation');
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  });

  it('route count matches expected total', () => {
    const expectedTotal =
      SESSION_ONLY_ROUTES.length +
      ADMIN_SESSION_ROUTES.length +
      API_KEY_OR_SESSION_ROUTES.length +
      ADMIN_API_KEY_OR_ADMIN_SESSION_ROUTES.length;

    expect(expectedTotal).toBe(76);
  });
});

function createRouterTestApp() {
  return buildApplication({
    mountRoutes: (app) => {
      app.use(router);
    },
  });
}

let keyCounter = 0;
function uniqueBearerToken() {
  return `nade_routertest_${++keyCounter}`;
}

function mockSessionAuth(userId: number) {
  mockGetSession.mockResolvedValue({ user: { id: String(userId) } });
}

function mockBetterAuthApiKey(userId: number, permissions: string[]): string {
  const token = uniqueBearerToken();
  mockVerifyApiKey.mockResolvedValue({
    valid: true,
    key: {
      id: 'ba-test-key',
      referenceId: String(userId),
      permissions: { api: permissions },
      metadata: null,
    },
  });
  return token;
}
