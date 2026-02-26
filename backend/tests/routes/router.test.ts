import 'dotenv/config';
import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi, type Mock } from 'bun:test';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { invalidateUserCache, invalidateApiKeyCacheForUser } from '@app/middleware/authCacheStore';
import { auth } from '@config/auth';
import { buildApplication } from '@config/application';
import { router } from '@app/routes/router';

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
  mockVerifyApiKey.mockReset();
  invalidateUserCache(fixtures.users.kevin.id);
  invalidateUserCache(fixtures.users.regular.id);
  invalidateApiKeyCacheForUser(fixtures.users.kevin.id);
  invalidateApiKeyCacheForUser(fixtures.users.regular.id);
});

const app = createRouterTestApp();

describe('route auth wiring', () => {
  describe('/v1/search', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await request(app).get('/v1/search').query({ q: 'test' });
      expect(res.status).toBe(401);
    });

    it('rejects API key without READ_MEDIA', async () => {
      const token = mockBetterAuthApiKey(fixtures.users.kevin.id, ['ADD_MEDIA']);
      const res = await request(app).get('/v1/search').query({ q: 'test' }).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('accepts API key with READ_MEDIA', async () => {
      const token = mockBetterAuthApiKey(fixtures.users.kevin.id, ['READ_MEDIA']);
      const res = await request(app).get('/v1/search').query({ q: 'test' }).set('Authorization', `Bearer ${token}`);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  });

  describe('/v1/media', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await request(app).get('/v1/media');
      expect(res.status).toBe(401);
    });

    it('rejects API key without READ_MEDIA on GET', async () => {
      const token = mockBetterAuthApiKey(fixtures.users.kevin.id, ['ADD_MEDIA']);
      const res = await request(app).get('/v1/media').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('accepts API key with READ_MEDIA on GET', async () => {
      const token = mockBetterAuthApiKey(fixtures.users.kevin.id, ['READ_MEDIA']);
      const res = await request(app).get('/v1/media').set('Authorization', `Bearer ${token}`);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it('rejects API key without ADD_MEDIA on POST /v1/media/:mediaId/episodes', async () => {
      const token = mockBetterAuthApiKey(fixtures.users.kevin.id, ['READ_MEDIA']);
      const res = await request(app).post('/v1/media/1/episodes').set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(403);
    });

    it('rejects API key without UPDATE_MEDIA on PATCH', async () => {
      const token = mockBetterAuthApiKey(fixtures.users.kevin.id, ['READ_MEDIA']);
      const res = await request(app).patch('/v1/media/1').set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(403);
    });

    it('rejects API key without REMOVE_MEDIA on DELETE', async () => {
      const token = mockBetterAuthApiKey(fixtures.users.kevin.id, ['READ_MEDIA']);
      const res = await request(app).delete('/v1/media/1').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    describe('PATCH /v1/media/segments/:uuid', () => {
      it('rejects unauthenticated requests', async () => {
        mockGetSession.mockResolvedValue(null);
        const res = await request(app).patch('/v1/media/segments/test-uuid').send({});
        expect(res.status).toBe(401);
      });

      it('rejects non-admin session', async () => {
        mockSessionAuth(fixtures.users.regular.id);
        const res = await request(app).patch('/v1/media/segments/test-uuid').send({});
        expect(res.status).toBe(403);
      });

      it('accepts admin session', async () => {
        mockSessionAuth(fixtures.users.kevin.id);
        const res = await request(app).patch('/v1/media/segments/test-uuid').send({});
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
      });

      it('rejects API key without UPDATE_MEDIA', async () => {
        const token = mockBetterAuthApiKey(fixtures.users.kevin.id, ['READ_MEDIA']);
        const res = await request(app).patch('/v1/media/segments/test-uuid').set('Authorization', `Bearer ${token}`).send({});
        expect(res.status).toBe(403);
      });

      it('accepts API key with UPDATE_MEDIA', async () => {
        const token = mockBetterAuthApiKey(fixtures.users.kevin.id, ['UPDATE_MEDIA']);
        const res = await request(app).patch('/v1/media/segments/test-uuid').set('Authorization', `Bearer ${token}`).send({});
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
      });
    });

    describe('GET /v1/media/segments/:uuid', () => {
      it('rejects unauthenticated requests', async () => {
        mockGetSession.mockResolvedValue(null);
        const res = await request(app).get('/v1/media/segments/test-uuid');
        expect(res.status).toBe(401);
      });

      it('rejects non-admin session', async () => {
        mockSessionAuth(fixtures.users.regular.id);
        const res = await request(app).get('/v1/media/segments/test-uuid');
        expect(res.status).toBe(403);
      });

      it('accepts admin session', async () => {
        mockSessionAuth(fixtures.users.kevin.id);
        const res = await request(app).get('/v1/media/segments/test-uuid');
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
      });

      it('rejects API key without UPDATE_MEDIA', async () => {
        const token = mockBetterAuthApiKey(fixtures.users.kevin.id, ['READ_MEDIA']);
        const res = await request(app).get('/v1/media/segments/test-uuid').set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(403);
      });

      it('accepts API key with UPDATE_MEDIA', async () => {
        const token = mockBetterAuthApiKey(fixtures.users.kevin.id, ['UPDATE_MEDIA']);
        const res = await request(app).get('/v1/media/segments/test-uuid').set('Authorization', `Bearer ${token}`);
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
      });
    });

    describe('GET /v1/media/segments/:uuid/context', () => {
      it('rejects API key without UPDATE_MEDIA', async () => {
        const token = mockBetterAuthApiKey(fixtures.users.kevin.id, ['READ_MEDIA']);
        const res = await request(app)
          .get('/v1/media/segments/test-uuid/context')
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(403);
      });

      it('accepts API key with UPDATE_MEDIA', async () => {
        const token = mockBetterAuthApiKey(fixtures.users.kevin.id, ['UPDATE_MEDIA']);
        const res = await request(app)
          .get('/v1/media/segments/test-uuid/context')
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
      });
    });
  });

  describe('/v1/user (session-only)', () => {
    it('rejects unauthenticated requests', async () => {
      mockGetSession.mockResolvedValue(null);
      const res = await request(app).get('/v1/user/preferences');
      expect(res.status).toBe(401);
    });

    it('rejects API key auth', async () => {
      const token = mockBetterAuthApiKey(fixtures.users.kevin.id, ['READ_MEDIA']);
      const res = await request(app).get('/v1/user/preferences').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    });

    it('accepts session auth', async () => {
      mockSessionAuth(fixtures.users.kevin.id);
      const res = await request(app).get('/v1/user/preferences');
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  });

  describe('/v1/user/quota (session-only)', () => {
    it('rejects unauthenticated requests', async () => {
      mockGetSession.mockResolvedValue(null);
      const res = await request(app).get('/v1/user/quota');
      expect(res.status).toBe(401);
    });

    it('rejects API key with READ_MEDIA', async () => {
      const token = mockBetterAuthApiKey(fixtures.users.kevin.id, ['READ_MEDIA']);
      const res = await request(app).get('/v1/user/quota').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    });

    it('rejects API key without READ_MEDIA', async () => {
      const token = mockBetterAuthApiKey(fixtures.users.kevin.id, ['ADD_MEDIA']);
      const res = await request(app).get('/v1/user/quota').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    });

    it('accepts session auth', async () => {
      mockSessionAuth(fixtures.users.kevin.id);
      const res = await request(app).get('/v1/user/quota');
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  });

  describe('/v1/admin', () => {
    it('rejects unauthenticated requests', async () => {
      mockGetSession.mockResolvedValue(null);
      const res = await request(app).get('/v1/admin/dashboard');
      expect(res.status).toBe(401);
    });

    it('rejects non-admin session', async () => {
      mockSessionAuth(fixtures.users.regular.id);
      const res = await request(app).get('/v1/admin/dashboard');
      expect(res.status).toBe(403);
    });

    it('accepts admin session', async () => {
      mockSessionAuth(fixtures.users.kevin.id);
      const res = await request(app).get('/v1/admin/dashboard');
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it('rejects API key auth (session-only)', async () => {
      const token = mockBetterAuthApiKey(fixtures.users.kevin.id, ['ADD_MEDIA']);
      const res = await request(app).get('/v1/admin/dashboard').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    });
  });

  describe('/v1/admin/impersonation', () => {
    it('allows unauthenticated POST requests in local environment', async () => {
      mockGetSession.mockResolvedValue(null);
      const res = await request(app).post('/v1/admin/impersonation').send({ userId: 99999999 });
      expect(res.status).toBe(404);
    });

    it('allows unauthenticated requests in local environment', async () => {
      mockGetSession.mockResolvedValue(null);
      const res = await request(app).delete('/v1/admin/impersonation');
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it('accepts admin session', async () => {
      mockSessionAuth(fixtures.users.kevin.id);
      const res = await request(app).delete('/v1/admin/impersonation');
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  });

  describe('/v1/collections', () => {
    it('rejects unauthenticated requests', async () => {
      mockGetSession.mockResolvedValue(null);
      const res = await request(app).get('/v1/collections');
      expect(res.status).toBe(401);
    });

    it('accepts session auth', async () => {
      mockSessionAuth(fixtures.users.kevin.id);
      const res = await request(app).get('/v1/collections');
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
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
      userId: String(userId),
      permissions: { api: permissions },
      metadata: null,
    },
  });
  return token;
}
