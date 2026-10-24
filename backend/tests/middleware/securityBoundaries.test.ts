import { request } from '../helpers/http';
import { type Application, type Request, type Response, type NextFunction } from 'express';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
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
    rateLimit: false,
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
    { method: 'get' as const, path: '/v1/collections' },
    { method: 'get' as const, path: '/v1/admin/reports' },
    { method: 'get' as const, path: '/v1/admin/users-with-providers' },
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
    { method: 'get' as const, path: '/v1/admin/reports' },
    { method: 'get' as const, path: '/v1/admin/agent-activity' },
    { method: 'get' as const, path: '/v1/admin/users-with-providers' },
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

    const res = await request(app).get('/v1/admin/reports');
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

describe('corpus write routes', () => {
  let app: Application;
  let authState: AuthState | null = null;

  beforeAll(() => {
    app = createSecurityApp(() => authState);
  });

  beforeEach(() => {
    authState = null;
  });

  // ApiKey-only corpus writes also receive session traffic through the frontend proxy; a session alone must not mutate
  // shared media.
  const corpusWriteRoutes = [
    { method: 'post' as const, path: '/v1/media' },
    { method: 'patch' as const, path: '/v1/media/TestMedia001' },
    { method: 'delete' as const, path: '/v1/media/TestMedia001' },
    { method: 'patch' as const, path: '/v1/media/segments/TestSeg001' },
    { method: 'post' as const, path: '/v1/media/TestMedia001/episodes' },
    { method: 'delete' as const, path: '/v1/media/TestMedia001/episodes/1' },
    { method: 'post' as const, path: '/v1/media/TestMedia001/episodes/1/segments' },
    { method: 'post' as const, path: '/v1/media/TestMedia001/episodes/1/segments/batch' },
  ];

  for (const route of corpusWriteRoutes) {
    it(`rejects non-admin session for ${route.method.toUpperCase()} ${route.path}`, async () => {
      authState = {
        user: fixtures.users.regular,
        type: AuthType.SESSION,
      };

      const res = await request(app)[route.method](route.path).send({});
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
    });
  }

  it('rejects unauthenticated corpus writes', async () => {
    const res = await request(app).post('/v1/media').send({});
    expect(res.status).toBe(401);
  });

  it('allows an admin session to reach the corpus write handler', async () => {
    authState = {
      user: fixtures.users.kevin,
      type: AuthType.SESSION,
    };

    const res = await request(app).post('/v1/media').send({});
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('allows a service key holding the required scope regardless of its owner role', async () => {
    authState = {
      user: fixtures.users.regular,
      type: AuthType.API_KEY,
      apiKey: {
        kind: ApiKeyKind.SERVICE,
        permissions: [ApiPermission.ADD_MEDIA],
      },
    };

    const res = await request(app).post('/v1/media').set('Authorization', 'Bearer fake_for_routing').send({});
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('allows a user key holding the required scope while its owner is still admin', async () => {
    authState = {
      user: fixtures.users.kevin,
      type: AuthType.API_KEY,
      apiKey: {
        kind: ApiKeyKind.USER,
        permissions: [ApiPermission.UPDATE_MEDIA],
      },
    };

    const res = await request(app)
      .patch('/v1/media/TestMedia001')
      .set('Authorization', 'Bearer fake_for_routing')
      .send({});
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  // A key minted while its owner was admin keeps its stored scopes; the owner's current role is what must gate it.
  const demotedKeyRoutes = [
    { method: 'patch' as const, path: '/v1/media/TestMedia001', permission: ApiPermission.UPDATE_MEDIA },
    { method: 'delete' as const, path: '/v1/media/TestMedia001', permission: ApiPermission.REMOVE_MEDIA },
    { method: 'post' as const, path: '/v1/media', permission: ApiPermission.ADD_MEDIA },
    { method: 'get' as const, path: '/v1/admin/reports', permission: ApiPermission.READ_ADMIN },
  ];

  for (const route of demotedKeyRoutes) {
    it(`rejects a demoted owner's user key on ${route.method.toUpperCase()} ${route.path}`, async () => {
      authState = {
        user: fixtures.users.regular,
        type: AuthType.API_KEY,
        apiKey: {
          kind: ApiKeyKind.USER,
          permissions: [route.permission],
        },
      };

      const res = await request(app)[route.method](route.path).set('Authorization', 'Bearer fake_for_routing').send({});
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
    });
  }

  it('still rejects an API key missing the required scope', async () => {
    authState = {
      user: fixtures.users.regular,
      type: AuthType.API_KEY,
      apiKey: {
        kind: ApiKeyKind.USER,
        permissions: [ApiPermission.READ_MEDIA],
      },
    };

    const res = await request(app)
      .post('/v1/media/TestMedia001/episodes/1/segments/batch')
      .set('Authorization', 'Bearer fake_for_routing')
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
  });
});

describe('session-accessible routes stay reachable', () => {
  let app: Application;
  let authState: AuthState | null = null;

  beforeAll(() => {
    app = createSecurityApp(() => authState);
  });

  // Session-only routes outside proxy key injection must remain usable; tightening corpus writes must not reject them.
  const sessionRoutes = [
    { method: 'get' as const, path: '/v1/media' },
    { method: 'get' as const, path: '/v1/user/me' },
    { method: 'get' as const, path: '/v1/collections' },
    { method: 'get' as const, path: '/v1/user/activity' },
  ];

  for (const route of sessionRoutes) {
    it(`allows a non-admin session on ${route.method.toUpperCase()} ${route.path}`, async () => {
      authState = {
        user: fixtures.users.regular,
        type: AuthType.SESSION,
      };

      const res = await request(app)[route.method](route.path);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  }
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

  it("lets an admin session read another user's private collection", async () => {
    const collection = await createCollectionAs(fixtures.users.regular);

    authState = { user: fixtures.users.kevin, type: AuthType.SESSION };

    const res = await request(app).get(`/v1/collections/${collection.publicId}`);
    expect(res.status).toBe(200);
  });

  for (const kind of [ApiKeyKind.USER, ApiKeyKind.SERVICE]) {
    it(`gives an admin-owned ${kind} key no access to another user's private collection`, async () => {
      const collection = await createCollectionAs(fixtures.users.regular);

      authState = {
        user: fixtures.users.kevin,
        type: AuthType.API_KEY,
        apiKey: { kind, permissions: [ApiPermission.READ_COLLECTIONS, ApiPermission.UPDATE_COLLECTIONS] },
      };

      const read = await request(app)
        .get(`/v1/collections/${collection.publicId}`)
        .set('Authorization', 'Bearer fake_for_routing');
      expect(read.status).toBe(403);

      const update = await request(app)
        .patch(`/v1/collections/${collection.publicId}`)
        .set('Authorization', 'Bearer fake_for_routing')
        .send({ name: 'Hijacked' });
      expect(update.status).toBe(403);
    });
  }
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

    const res = await request(app).get('/v1/admin/reports');
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

    const res = await request(app).get('/v1/admin/reports');
    expect(res.status).toBe(403);
  });
});

describe('collections auth matrix', () => {
  let app: Application;
  let authState: AuthState | null = null;

  beforeAll(() => {
    app = createSecurityApp(() => authState);
  });

  async function ownedCollection(): Promise<Collection> {
    return Collection.save({
      publicId: nanoid(12),
      name: 'Matrix collection',
      visibility: CollectionVisibility.PRIVATE,
      userId: fixtures.users.regular.id,
    });
  }

  function asApiKey(permissions: ApiPermission[]): AuthState {
    return {
      user: fixtures.users.regular,
      type: AuthType.API_KEY,
      apiKey: { kind: ApiKeyKind.USER, permissions },
    };
  }

  // Grant the missing matching scope without removing session access; sibling routes already use the same model.
  it('lets an API key with UPDATE_COLLECTIONS rename a collection', async () => {
    const collection = await ownedCollection();
    authState = asApiKey([ApiPermission.UPDATE_COLLECTIONS]);

    const res = await request(app)
      .patch(`/v1/collections/${collection.publicId}`)
      .set('Authorization', 'Bearer fake_for_routing')
      .send({ name: 'Renamed by key' });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('rejects a collection rename by a key without UPDATE_COLLECTIONS', async () => {
    const collection = await ownedCollection();
    authState = asApiKey([ApiPermission.READ_COLLECTIONS]);

    const res = await request(app)
      .patch(`/v1/collections/${collection.publicId}`)
      .set('Authorization', 'Bearer fake_for_routing')
      .send({ name: 'Renamed by key' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('lets an API key with READ_COLLECTIONS read collection stats', async () => {
    const collection = await ownedCollection();
    authState = asApiKey([ApiPermission.READ_COLLECTIONS]);

    const res = await request(app)
      .get(`/v1/collections/${collection.publicId}/stats`)
      .set('Authorization', 'Bearer fake_for_routing');
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('rejects collection stats for a key without READ_COLLECTIONS', async () => {
    const collection = await ownedCollection();
    authState = asApiKey([ApiPermission.CREATE_COLLECTIONS]);

    const res = await request(app)
      .get(`/v1/collections/${collection.publicId}/stats`)
      .set('Authorization', 'Bearer fake_for_routing');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('rejects a collection segment update by a key without UPDATE_COLLECTIONS', async () => {
    const collection = await ownedCollection();
    authState = asApiKey([ApiPermission.READ_COLLECTIONS]);

    const res = await request(app)
      .patch(`/v1/collections/${collection.publicId}/segments/TestSeg001`)
      .set('Authorization', 'Bearer fake_for_routing')
      .send({ position: 2 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  const sessionReachableRoutes = [
    { method: 'patch' as const, path: (id: string) => `/v1/collections/${id}`, body: { name: 'Renamed' } },
    { method: 'get' as const, path: (id: string) => `/v1/collections/${id}/stats`, body: null },
    {
      method: 'patch' as const,
      path: (id: string) => `/v1/collections/${id}/segments/TestSeg001`,
      body: { position: 2 },
    },
  ];

  for (const route of sessionReachableRoutes) {
    it(`keeps ${route.method.toUpperCase()} ${route.path('{id}')} reachable with only a session`, async () => {
      const collection = await ownedCollection();
      authState = { user: fixtures.users.regular, type: AuthType.SESSION };

      const pending = request(app)[route.method](route.path(collection.publicId));
      const res = await (route.body ? pending.send(route.body) : pending);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  }
});
