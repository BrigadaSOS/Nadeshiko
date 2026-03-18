import 'dotenv/config';
import request from 'supertest';
import { type Application, type Request, type Response, type NextFunction } from 'express';
import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
import { nanoid } from 'nanoid';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { routeAuth } from 'generated/routeAuth';
import { buildApplication } from '@config/application';
import { MediaRoutes, UserRoutes, CollectionsRoutes, AdminRoutes } from '@config/routes';
import { AuthType, ApiKeyKind, ApiPermission } from '@app/models/ApiPermission';
import { User, UserRoleType } from '@app/models/User';
import { Collection, CollectionVisibility } from '@app/models/Collection';

setupTestSuite();

let fixtures: CoreFixtures;

beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});

interface AuthState {
  user: User;
  type: AuthType;
  apiKey?: {
    kind: ApiKeyKind;
    permissions: ApiPermission[];
  };
}

function createSecurityApp(getAuth: () => AuthState | null): Application {
  const authMiddleware = (req: Request, _res: Response, next: NextFunction) => {
    const state = getAuth();
    if (state) {
      req.user = state.user;
      req.auth = {
        type: state.type,
        ...(state.apiKey ? { apiKey: state.apiKey } : {}),
      };
    }
    next();
  };

  return buildApplication({
    beforeRoutes: [authMiddleware],
    mountRoutes: (app) => {
      for (const { method, path, middleware } of routeAuth) {
        app[method as 'get' | 'post' | 'patch' | 'put' | 'delete'](path, middleware);
      }
      app.use('/', MediaRoutes);
      app.use('/', UserRoutes);
      app.use('/', CollectionsRoutes);
      app.use('/', AdminRoutes);
    },
  });
}

describe('unauthenticated access', () => {
  let app: Application;

  beforeAll(() => {
    app = createSecurityApp(() => null);
  });

  const protectedRoutes = [
    { method: 'get' as const, path: '/v1/media' },
    { method: 'get' as const, path: '/v1/user/quota' },
    { method: 'get' as const, path: '/v1/collections' },
    { method: 'get' as const, path: '/v1/admin/dashboard' },
    { method: 'get' as const, path: '/v1/admin/health' },
  ];

  for (const route of protectedRoutes) {
    it(`rejects unauthenticated ${route.method.toUpperCase()} ${route.path}`, async () => {
      const res = await request(app)[route.method](route.path);
      expect(res.status).toBe(401);
    });
  }
});

describe('admin route protection', () => {
  let app: Application;
  let authState: AuthState | null = null;

  beforeAll(() => {
    app = createSecurityApp(() => authState);
  });

  const adminRoutes = [
    { method: 'get' as const, path: '/v1/admin/dashboard' },
    { method: 'get' as const, path: '/v1/admin/health' },
    { method: 'get' as const, path: '/v1/admin/queues/stats' },
    { method: 'get' as const, path: '/v1/admin/reports' },
    { method: 'get' as const, path: '/v1/admin/media/audits' },
  ];

  for (const route of adminRoutes) {
    it(`rejects non-admin session for ${route.method.toUpperCase()} ${route.path}`, async () => {
      authState = {
        user: fixtures.users.regular,
        type: AuthType.SESSION,
      };

      const res = await request(app)[route.method](route.path);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
    });
  }

  it('allows admin session to access admin routes', async () => {
    authState = {
      user: fixtures.users.kevin,
      type: AuthType.SESSION,
    };

    const res = await request(app).get('/v1/admin/health');
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

describe('API key permission scoping', () => {
  let app: Application;
  let authState: AuthState | null = null;

  beforeAll(() => {
    app = createSecurityApp(() => authState);
  });

  beforeEach(() => {
    authState = null;
  });

  it('rejects API key with READ_MEDIA attempting to create media', async () => {
    authState = {
      user: fixtures.users.kevin,
      type: AuthType.API_KEY,
      apiKey: {
        kind: ApiKeyKind.USER,
        permissions: [ApiPermission.READ_MEDIA],
      },
    };

    const res = await request(app).post('/v1/media').set('Authorization', 'Bearer fake_for_routing').send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('rejects API key with READ_MEDIA attempting to update media', async () => {
    authState = {
      user: fixtures.users.kevin,
      type: AuthType.API_KEY,
      apiKey: {
        kind: ApiKeyKind.USER,
        permissions: [ApiPermission.READ_MEDIA],
      },
    };

    const res = await request(app).patch('/v1/media/999').set('Authorization', 'Bearer fake_for_routing').send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('rejects API key with READ_MEDIA attempting to delete media', async () => {
    authState = {
      user: fixtures.users.kevin,
      type: AuthType.API_KEY,
      apiKey: {
        kind: ApiKeyKind.USER,
        permissions: [ApiPermission.READ_MEDIA],
      },
    };

    const res = await request(app).delete('/v1/media/999').set('Authorization', 'Bearer fake_for_routing');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('rejects API key with ADD_MEDIA attempting to delete', async () => {
    authState = {
      user: fixtures.users.kevin,
      type: AuthType.API_KEY,
      apiKey: {
        kind: ApiKeyKind.USER,
        permissions: [ApiPermission.ADD_MEDIA],
      },
    };

    const res = await request(app).delete('/v1/media/999').set('Authorization', 'Bearer fake_for_routing');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('allows API key with correct permission', async () => {
    authState = {
      user: fixtures.users.kevin,
      type: AuthType.API_KEY,
      apiKey: {
        kind: ApiKeyKind.USER,
        permissions: [ApiPermission.READ_MEDIA],
      },
    };

    const res = await request(app).get('/v1/media').set('Authorization', 'Bearer fake_for_routing');
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('session auth bypasses API key permission checks', async () => {
    authState = {
      user: fixtures.users.kevin,
      type: AuthType.SESSION,
    };

    const res = await request(app).get('/v1/media');
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

describe('cross-user collection isolation', () => {
  let app: Application;
  let authState: AuthState | null = null;

  beforeAll(() => {
    app = createSecurityApp(() => authState);
  });

  async function createCollectionAs(user: User): Promise<Collection> {
    authState = { user, type: AuthType.SESSION };
    return Collection.save({
      publicId: nanoid(12),
      name: `${user.username}'s collection`,
      visibility: CollectionVisibility.PRIVATE,
      userId: user.id,
    });
  }

  it("prevents accessing another user's private collection", async () => {
    const collection = await createCollectionAs(fixtures.users.kevin);

    authState = {
      user: fixtures.users.regular,
      type: AuthType.SESSION,
    };

    const res = await request(app).get(`/v1/collections/${collection.publicId}`);
    expect(res.status).toBe(403);
  });

  it("prevents deleting another user's collection", async () => {
    const collection = await createCollectionAs(fixtures.users.kevin);

    authState = {
      user: fixtures.users.regular,
      type: AuthType.SESSION,
    };

    const res = await request(app).delete(`/v1/collections/${collection.publicId}`);
    expect(res.status).toBe(403);
  });

  it("prevents updating another user's collection", async () => {
    const collection = await createCollectionAs(fixtures.users.kevin);

    authState = {
      user: fixtures.users.regular,
      type: AuthType.SESSION,
    };

    const res = await request(app).patch(`/v1/collections/${collection.publicId}`).send({ name: 'Hijacked' });
    expect(res.status).toBe(403);
  });

  it('allows owner to access their own private collection', async () => {
    const collection = await createCollectionAs(fixtures.users.kevin);

    authState = {
      user: fixtures.users.kevin,
      type: AuthType.SESSION,
    };

    const res = await request(app).get(`/v1/collections/${collection.publicId}`);
    expect(res.status).toBe(200);
  });
});

describe('admin role boundary', () => {
  let app: Application;
  let authState: AuthState | null = null;

  beforeAll(() => {
    app = createSecurityApp(() => authState);
  });

  it('rejects MOD role on admin endpoints', async () => {
    const modUser = await User.save({
      username: 'moderator',
      email: 'mod@nadeshiko.test',
      isVerified: true,
      isActive: true,
      role: UserRoleType.MOD,
      preferences: {},
    });

    authState = {
      user: modUser,
      type: AuthType.SESSION,
    };

    const res = await request(app).get('/v1/admin/dashboard');
    expect(res.status).toBe(403);
  });

  it('rejects PATREON role on admin endpoints', async () => {
    const patreonUser = await User.save({
      username: 'patron',
      email: 'patron@nadeshiko.test',
      isVerified: true,
      isActive: true,
      role: UserRoleType.PATREON,
      preferences: {},
    });

    authState = {
      user: patreonUser,
      type: AuthType.SESSION,
    };

    const res = await request(app).get('/v1/admin/dashboard');
    expect(res.status).toBe(403);
  });
});
