import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi, type Mock } from 'vitest';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { sessionResult } from '../helpers/session';
import { invalidateUserCache, invalidateApiKeyCacheForUser } from '@app/middleware/authCacheStore';
import { auth } from '@config/auth';
import { buildApplication } from '@config/application';
import { router } from '@config/routes';
import { EMAIL_LINK_PATH, issueReturnToken } from '@app/services/email/returnLink';

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
  mockGetSession.mockResolvedValue(sessionResult(null));
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
];

const ADMIN_SESSION_ROUTES: RouteEntry[] = [
  // The report queue read and the single-report update moved to
  // API_KEY_OR_SESSION_ROUTES: the moderation agent works that queue with a
  // service key. batch, bulk and delete stay here deliberately.
  { method: 'patch', path: '/v1/admin/reports/batch' },
  { method: 'put', path: '/v1/admin/announcement' },
  { method: 'get', path: '/v1/admin/users-with-providers' },
];

// Mirrors CORPUS_WRITE_PERMISSIONS in bin/generateRouteAuth.ts. Routes carrying
// one of these mutate the shared media corpus, so a session reaching them has to
// belong to an admin — an API key still only needs the matching scope.
const CORPUS_WRITE_PERMISSIONS = new Set(['ADD_MEDIA', 'UPDATE_MEDIA', 'REMOVE_MEDIA']);

/**
 * `adminSession` marks routes whose spec carries `SessionCookie: [ADMIN]` next to
 * the ApiKey requirement. The generator applies `enforceSessionAdmin` for those as
 * well as for corpus writes, so a regular session is refused either way — but the
 * permission alone cannot tell you which, since the scope may be a read.
 */
const API_KEY_OR_SESSION_ROUTES: { method: Method; path: string; permission: string; adminSession?: boolean }[] = [
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
  { method: 'post', path: '/v1/media/segments/V1StGXR8_Z5d/revisions/1/restore', permission: 'UPDATE_MEDIA' },
  { method: 'post', path: '/v1/media/V1StGXR8_Z5d/episodes/1/segments/moderate', permission: 'UPDATE_MEDIA' },
  { method: 'get', path: '/v1/admin/agent-activity', permission: 'READ_ADMIN', adminSession: true },
  { method: 'get', path: '/v1/admin/reports', permission: 'READ_ADMIN', adminSession: true },
  { method: 'patch', path: '/v1/admin/reports/1', permission: 'UPDATE_MEDIA', adminSession: true },
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
  { method: 'patch', path: '/v1/collections/V1StGXR8_Z5d', permission: 'UPDATE_COLLECTIONS' },
  { method: 'patch', path: '/v1/collections/V1StGXR8_Z5d/segments/V1StGXR8_Z5d', permission: 'UPDATE_COLLECTIONS' },
  { method: 'get', path: '/v1/collections/V1StGXR8_Z5d/stats', permission: 'READ_COLLECTIONS' },
];

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

        if (CORPUS_WRITE_PERMISSIONS.has(route.permission) || route.adminSession) {
          it('rejects regular session auth with 403', async () => {
            mockSessionAuth(fixtures.users.regular.id);
            const res = await sendRequest(route.method, route.path);
            expect(res.status).toBe(403);
          });

          it('accepts admin session auth', async () => {
            mockSessionAuth(fixtures.users.kevin.id);
            const res = await sendRequest(route.method, route.path);
            expect(res.status).not.toBe(401);
            expect(res.status).not.toBe(403);
          });
        } else {
          it('accepts regular session auth (no permission check)', async () => {
            mockSessionAuth(fixtures.users.regular.id);
            const res = await sendRequest(route.method, route.path);
            expect(res.status).not.toBe(401);
            expect(res.status).not.toBe(403);
          });
        }
      });
    }
  });

  it('route count matches expected total', () => {
    const expectedTotal = SESSION_ONLY_ROUTES.length + ADMIN_SESSION_ROUTES.length + API_KEY_OR_SESSION_ROUTES.length;

    expect(expectedTotal).toBe(54);
  });
});

describe('GET /v1/email/link', () => {
  /**
   * Registered by hand rather than generated, so nothing else asserts it
   * resolves. It carries no security requirement and must not pick one up: the
   * reader clicking it is by definition somebody we have not seen in a month,
   * and quite possibly signed out.
   */
  it('answers a browser without a session, and is never cached', async () => {
    const token = issueReturnToken({ userId: 1, kind: 'dormant-30', campaign: 'dormant-30-2026-08' });
    const res = await request(createRouterTestApp()).get(
      `${EMAIL_LINK_PATH}?t=${encodeURIComponent(token)}&to=%2Fmedia%2Ffrieren&c=cta`,
    );

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/media/frieren');
    // A cached redirect would hand one recipient's destination to another.
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

function createRouterTestApp() {
  return buildApplication({
    rateLimit: false,
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
  mockGetSession.mockResolvedValue(sessionResult({ user: { id: String(userId) } }));
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
