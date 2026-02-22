import 'dotenv/config';
import request from 'supertest';
import express, { type Request, type Response, type ErrorRequestHandler } from 'express';
import crypto from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'bun:test';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { requestIdMiddleware } from '@app/middleware/requestId';
import {
  requireApiKeyAuth,
  requireSessionAuth,
  assertUser,
  invalidateUserCache,
} from '@app/middleware/authentication';
import { handleErrors } from '@app/middleware/errorHandler';
import { ApiAuth, User } from '@app/models';

// ---------------------------------------------------------------------------
// Mock better-auth — module loads eagerly, so vi.mock must run before import
// ---------------------------------------------------------------------------

const mockGetSession = vi.fn();
const mockVerifyApiKey = vi.fn();

vi.mock('@config/auth', () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      verifyApiKey: (...args: unknown[]) => mockVerifyApiKey(...args),
    },
  },
}));

// ---------------------------------------------------------------------------
// DB setup (transaction-wrapped isolation like controller tests)
// ---------------------------------------------------------------------------

setupTestSuite();

let fixtures: CoreFixtures;
beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});

beforeEach(() => {
  mockGetSession.mockReset();
  mockVerifyApiKey.mockReset();
  invalidateUserCache(fixtures.users.kevin.id);
  invalidateUserCache(fixtures.users.david.id);
});

// ---------------------------------------------------------------------------
// App factories — use real auth middleware instead of testAuthMiddleware
// ---------------------------------------------------------------------------

function createApiKeyApp() {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(express.json());
  app.use(requireApiKeyAuth);
  app.get('/test', (req: Request, res: Response) => {
    res.status(200).json({
      userId: req.user?.id,
      authType: req.auth?.type,
      permissions: req.auth?.apiKey?.permissions,
    });
  });
  app.use(handleErrors as ErrorRequestHandler);
  return app;
}

function createSessionApp() {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(express.json());
  app.use(requireSessionAuth);
  app.get('/test', (req: Request, res: Response) => {
    res.status(200).json({
      userId: req.user?.id,
      authType: req.auth?.type,
    });
  });
  app.use(handleErrors as ErrorRequestHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Legacy API key auth
// ---------------------------------------------------------------------------

describe('requireApiKeyAuth — legacy keys', () => {
  it('authenticates with a valid legacy API key', async () => {
    const plainKey = 'test_legacy_key_abc123';
    const hashedKey = crypto.createHash('sha256').update(plainKey).digest('hex');

    await ApiAuth.save({
      token: hashedKey,
      isActive: true,
      userId: fixtures.users.kevin.id,
    });

    const app = createApiKeyApp();
    const res = await request(app).get('/test').set('Authorization', `Bearer ${plainKey}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      userId: fixtures.users.kevin.id,
      authType: 'api-key-legacy',
    });
  });

  it('returns 401 for an invalid legacy API key', async () => {
    const app = createApiKeyApp();
    const res = await request(app).get('/test').set('Authorization', 'Bearer totally_invalid_key');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'AUTH_CREDENTIALS_INVALID' });
  });

  it('returns 401 for a deactivated legacy API key', async () => {
    const plainKey = 'test_deactivated_key_xyz';
    const hashedKey = crypto.createHash('sha256').update(plainKey).digest('hex');

    await ApiAuth.save({
      token: hashedKey,
      isActive: false,
      userId: fixtures.users.kevin.id,
    });

    const app = createApiKeyApp();
    const res = await request(app).get('/test').set('Authorization', `Bearer ${plainKey}`);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'AUTH_CREDENTIALS_EXPIRED' });
  });

  it('returns 401 when no Authorization header is present', async () => {
    const app = createApiKeyApp();
    const res = await request(app).get('/test');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'AUTH_CREDENTIALS_REQUIRED' });
  });

  it('returns 401 when Authorization header has no Bearer token', async () => {
    const app = createApiKeyApp();
    const res = await request(app).get('/test').set('Authorization', 'Basic abc123');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'AUTH_CREDENTIALS_REQUIRED' });
  });
});

// ---------------------------------------------------------------------------
// Better Auth API key
// ---------------------------------------------------------------------------

describe('requireApiKeyAuth — better-auth keys', () => {
  it('authenticates with a valid better-auth API key', async () => {
    mockVerifyApiKey.mockResolvedValue({
      valid: true,
      key: {
        id: 'ba-key-1',
        userId: String(fixtures.users.kevin.id),
        permissions: { api: ['READ_MEDIA', 'ADD_MEDIA'] },
        metadata: null,
      },
    });

    const app = createApiKeyApp();
    const res = await request(app).get('/test').set('Authorization', 'Bearer nade_testkey123');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      userId: fixtures.users.kevin.id,
      authType: 'api-key',
      permissions: expect.arrayContaining(['READ_MEDIA', 'ADD_MEDIA']),
    });
  });

  it('returns 401 when better-auth reports invalid key', async () => {
    mockVerifyApiKey.mockResolvedValue({
      valid: false,
      error: { code: 'INVALID_API_KEY' },
    });

    const app = createApiKeyApp();
    const res = await request(app).get('/test').set('Authorization', 'Bearer nade_badkey');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'AUTH_CREDENTIALS_INVALID' });
  });

  it('returns 401 when better-auth reports expired key', async () => {
    mockVerifyApiKey.mockResolvedValue({
      valid: false,
      error: { code: 'KEY_EXPIRED' },
    });

    const app = createApiKeyApp();
    const res = await request(app).get('/test').set('Authorization', 'Bearer nade_expiredkey');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'AUTH_CREDENTIALS_EXPIRED' });
  });

  it('returns 429 when better-auth reports rate limited', async () => {
    mockVerifyApiKey.mockResolvedValue({
      valid: false,
      error: { code: 'RATE_LIMITED' },
    });

    const app = createApiKeyApp();
    const res = await request(app).get('/test').set('Authorization', 'Bearer nade_ratelimited');

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' });
  });

  it('identifies service keys from metadata', async () => {
    mockVerifyApiKey.mockResolvedValue({
      valid: true,
      key: {
        id: 'ba-service-1',
        userId: String(fixtures.users.kevin.id),
        permissions: { api: ['READ_MEDIA'] },
        metadata: { keyType: 'service' },
      },
    });

    const app = createApiKeyApp();
    const res = await request(app).get('/test').set('Authorization', 'Bearer nade_servicekey');

    expect(res.status).toBe(200);
    expect(res.body.authType).toBe('api-key');
  });
});

// ---------------------------------------------------------------------------
// Session auth
// ---------------------------------------------------------------------------

describe('requireSessionAuth', () => {
  it('authenticates with a valid session', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: String(fixtures.users.kevin.id) },
    });

    const app = createSessionApp();
    const res = await request(app).get('/test');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      userId: fixtures.users.kevin.id,
      authType: 'session',
    });
  });

  it('returns 401 when session is missing', async () => {
    mockGetSession.mockResolvedValue(null);

    const app = createSessionApp();
    const res = await request(app).get('/test');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'AUTH_CREDENTIALS_REQUIRED' });
  });

  it('returns 401 when session has no user id', async () => {
    mockGetSession.mockResolvedValue({ user: {} });

    const app = createSessionApp();
    const res = await request(app).get('/test');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'AUTH_CREDENTIALS_REQUIRED' });
  });

  it('returns 401 when session lookup throws', async () => {
    mockGetSession.mockRejectedValue(new Error('session store unavailable'));

    const app = createSessionApp();
    const res = await request(app).get('/test');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'AUTH_CREDENTIALS_INVALID' });
  });
});

// ---------------------------------------------------------------------------
// User cache behavior
// ---------------------------------------------------------------------------

describe('user cache', () => {
  it('returns 401 for an inactive user', async () => {
    const inactiveUser = await User.save({
      username: 'inactive',
      email: 'inactive@nadeshiko.test',
      isVerified: true,
      isActive: false,
      preferences: {},
    });

    const plainKey = 'test_inactive_user_key';
    const hashedKey = crypto.createHash('sha256').update(plainKey).digest('hex');

    await ApiAuth.save({
      token: hashedKey,
      isActive: true,
      userId: inactiveUser.id,
    });

    const app = createApiKeyApp();
    const res = await request(app).get('/test').set('Authorization', `Bearer ${plainKey}`);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'AUTH_CREDENTIALS_INVALID' });
  });
});

// ---------------------------------------------------------------------------
// assertUser
// ---------------------------------------------------------------------------

describe('assertUser', () => {
  it('returns req.user when set', () => {
    const user = fixtures.users.kevin;
    const req = { user } as any;

    expect(assertUser(req)).toBe(user);
  });

  it('throws when req.user is not set', () => {
    const req = {} as any;

    expect(() => assertUser(req)).toThrow('assertUser: req.user is not set');
  });
});
