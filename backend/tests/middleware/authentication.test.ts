import 'dotenv/config';
import request from 'supertest';
import express, { type Request, type Response, type ErrorRequestHandler } from 'express';
import crypto from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi, type Mock } from 'bun:test';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { requestIdMiddleware } from '@app/middleware/requestId';
import { requireApiKeyAuth, requireSessionAuth, assertUser } from '@app/middleware/authentication';
import { invalidateUserCache, invalidateApiKeyCacheForUser } from '@app/middleware/authCacheStore';
import { handleErrors } from '@app/middleware/errorHandler';
import { ApiAuth, User } from '@app/models';
import { auth } from '@config/auth';

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
  invalidateUserCache(fixtures.users.david.id);
});

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
    expect(res.body).toMatchObject({ code: 'AUTH_CREDENTIALS_INVALID' });
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

// Better Auth API key

describe('requireApiKeyAuth — better-auth keys', () => {
  it('authenticates with a valid better-auth API key', async () => {
    mockVerifyApiKey.mockResolvedValue({
      valid: true,
      key: {
        id: 'ba-key-1',
        referenceId: String(fixtures.users.kevin.id),
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

  it('uses the session user as request context for trusted service keys', async () => {
    mockVerifyApiKey.mockResolvedValue({
      valid: true,
      key: {
        id: 'ba-service-session',
        referenceId: String(fixtures.users.kevin.id),
        permissions: { api: ['READ_MEDIA'] },
        metadata: { keyType: 'service' },
      },
    });
    mockGetSession.mockResolvedValue({
      user: { id: String(fixtures.users.david.id) },
    });

    const app = createApiKeyApp();
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer nade_service_session')
      .set('Cookie', 'nadeshiko.session_token=test-session');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      userId: fixtures.users.david.id,
      authType: 'api-key',
      permissions: ['READ_MEDIA'],
    });
  });

  it('keeps the API key owner as request context for non-service keys even when a session is present', async () => {
    mockVerifyApiKey.mockResolvedValue({
      valid: true,
      key: {
        id: 'ba-user-session',
        referenceId: String(fixtures.users.kevin.id),
        permissions: { api: ['READ_MEDIA'] },
        metadata: { keyType: 'user' },
      },
    });
    mockGetSession.mockResolvedValue({
      user: { id: String(fixtures.users.david.id) },
    });

    const app = createApiKeyApp();
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer nade_user_session')
      .set('Cookie', 'nadeshiko.session_token=test-session');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      userId: fixtures.users.kevin.id,
      authType: 'api-key',
      permissions: ['READ_MEDIA'],
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
        referenceId: String(fixtures.users.kevin.id),
        permissions: { api: ['READ_MEDIA'] },
        metadata: { keyType: 'service' },
      },
    });

    const app = createApiKeyApp();
    const res = await request(app).get('/test').set('Authorization', 'Bearer nade_servicekey');

    expect(res.status).toBe(200);
    expect(res.body.authType).toBe('api-key');
  });

  it('returns 429 QUOTA_EXCEEDED when better-auth reports usage exceeded', async () => {
    mockVerifyApiKey.mockResolvedValue({
      valid: false,
      error: { code: 'USAGE_EXCEEDED' },
    });

    const app = createApiKeyApp();
    const res = await request(app).get('/test').set('Authorization', 'Bearer nade_usageexceeded');

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });

  it('returns 401 AUTH_CREDENTIALS_EXPIRED when better-auth reports key disabled', async () => {
    mockVerifyApiKey.mockResolvedValue({
      valid: false,
      error: { code: 'KEY_DISABLED' },
    });

    const app = createApiKeyApp();
    const res = await request(app).get('/test').set('Authorization', 'Bearer nade_disabled');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'AUTH_CREDENTIALS_EXPIRED' });
  });

  it('returns 401 AUTH_CREDENTIALS_INVALID when better-auth reports key not found', async () => {
    mockVerifyApiKey.mockResolvedValue({
      valid: false,
      error: { code: 'KEY_NOT_FOUND' },
    });

    const app = createApiKeyApp();
    const res = await request(app).get('/test').set('Authorization', 'Bearer nade_notfound');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'AUTH_CREDENTIALS_INVALID' });
  });

  it('returns mapped error when verifyApiKey throws a rate-limit error', async () => {
    mockVerifyApiKey.mockRejectedValue({ statusCode: 429, body: { code: 'RATE_LIMITED' } });

    const app = createApiKeyApp();
    const res = await request(app).get('/test').set('Authorization', 'Bearer nade_throwratelimit');

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' });
  });

  it('returns 500 when verifyApiKey throws an unmapped error', async () => {
    mockVerifyApiKey.mockRejectedValue(new Error('network down'));

    const app = createApiKeyApp();
    const res = await request(app).get('/test').set('Authorization', 'Bearer nade_networkerror');

    expect(res.status).toBe(500);
  });

  it('returns 401 when verification is invalid with no error code', async () => {
    mockVerifyApiKey.mockResolvedValue({ valid: false });

    const app = createApiKeyApp();
    const res = await request(app).get('/test').set('Authorization', 'Bearer nade_noerrorcode');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'AUTH_CREDENTIALS_INVALID' });
  });

  it('maps 429 statusCode to RateLimitExceededError', async () => {
    mockVerifyApiKey.mockRejectedValue({ statusCode: 429, body: {} });

    const app = createApiKeyApp();
    const res = await request(app).get('/test').set('Authorization', 'Bearer nade_429nobodycode');

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' });
  });

  it('maps 429 with usage exceeded message to QuotaExceededError', async () => {
    mockVerifyApiKey.mockRejectedValue({ statusCode: 429, message: 'usage exceeded', body: {} });

    const app = createApiKeyApp();
    const res = await request(app).get('/test').set('Authorization', 'Bearer nade_429usageexceeded');

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });

  it('maps 401 with invalid api key message', async () => {
    mockVerifyApiKey.mockRejectedValue({ statusCode: 401, message: 'invalid api key', body: {} });

    const app = createApiKeyApp();
    const res = await request(app).get('/test').set('Authorization', 'Bearer nade_401invalidkey');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'AUTH_CREDENTIALS_INVALID' });
  });

  it('parses stringified JSON metadata', async () => {
    mockVerifyApiKey.mockResolvedValue({
      valid: true,
      key: {
        id: 'ba-str-meta',
        referenceId: String(fixtures.users.kevin.id),
        permissions: { api: ['READ_MEDIA'] },
        metadata: '{"keyType":"service"}',
      },
    });

    const app = createApiKeyApp();
    const res = await request(app).get('/test').set('Authorization', 'Bearer nade_strmeta');

    expect(res.status).toBe(200);
  });

  it('identifies service keys from isService metadata flag', async () => {
    mockVerifyApiKey.mockResolvedValue({
      valid: true,
      key: {
        id: 'ba-isservice',
        referenceId: String(fixtures.users.kevin.id),
        permissions: { api: ['READ_MEDIA'] },
        metadata: { isService: true },
      },
    });

    const app = createApiKeyApp();
    const res = await request(app).get('/test').set('Authorization', 'Bearer nade_isservice');

    expect(res.status).toBe(200);
  });
});

// Session auth

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

// Idempotent guard — skip auth when req.auth is already set

describe('idempotent guard', () => {
  it('requireSessionAuth skips when req.auth is already set', async () => {
    const app = express();
    app.use(requestIdMiddleware);
    app.use(express.json());
    // Pre-set auth as if API key middleware already ran
    app.use((req: Request, _res: Response, next) => {
      req.user = fixtures.users.kevin;
      req.auth = { type: 'api-key' as any, apiKey: { kind: 'user' as any, permissions: [] } };
      next();
    });
    app.use(requireSessionAuth);
    app.get('/test', (req: Request, res: Response) => {
      res.status(200).json({ authType: req.auth?.type });
    });
    app.use(handleErrors as ErrorRequestHandler);

    // No session mock — would 401 if the guard didn't skip
    mockGetSession.mockResolvedValue(null);

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.authType).toBe('api-key');
  });

  it('requireApiKeyAuth skips when req.auth is already set', async () => {
    const app = express();
    app.use(requestIdMiddleware);
    app.use(express.json());
    // Pre-set auth as if session middleware already ran
    app.use((req: Request, _res: Response, next) => {
      req.user = fixtures.users.kevin;
      req.auth = { type: 'session' as any };
      next();
    });
    app.use(requireApiKeyAuth);
    app.get('/test', (req: Request, res: Response) => {
      res.status(200).json({ authType: req.auth?.type });
    });
    app.use(handleErrors as ErrorRequestHandler);

    // No bearer token — would 401 if the guard didn't skip
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.authType).toBe('session');
  });
});

// User cache behavior

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

describe('user cache — expiry', () => {
  it('evicts expired user cache entries', async () => {
    invalidateUserCache(fixtures.users.kevin.id);
    invalidateApiKeyCacheForUser(fixtures.users.kevin.id);

    const originalDateNow = Date.now;
    let currentTime = originalDateNow();
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

    mockVerifyApiKey.mockResolvedValue({
      valid: true,
      key: {
        id: 'ba-cache-ttl-1',
        referenceId: String(fixtures.users.kevin.id),
        permissions: { api: ['READ_MEDIA'] },
        metadata: null,
      },
    });

    const app = createApiKeyApp();
    const firstRes = await request(app).get('/test').set('Authorization', 'Bearer nade_cachettl1');
    expect(firstRes.status).toBe(200);

    const findOneSpy = vi.spyOn(User, 'findOne');

    currentTime += 6 * 60 * 1000;

    invalidateApiKeyCacheForUser(fixtures.users.kevin.id);
    mockVerifyApiKey.mockResolvedValue({
      valid: true,
      key: {
        id: 'ba-cache-ttl-2',
        referenceId: String(fixtures.users.kevin.id),
        permissions: { api: ['READ_MEDIA'] },
        metadata: null,
      },
    });

    const secondRes = await request(app).get('/test').set('Authorization', 'Bearer nade_cachettl2');
    expect(secondRes.status).toBe(200);

    expect(findOneSpy).toHaveBeenCalled();

    findOneSpy.mockRestore();
    vi.spyOn(Date, 'now').mockRestore();
  });

  it('evicts expired API key cache entries', async () => {
    invalidateUserCache(fixtures.users.kevin.id);
    invalidateApiKeyCacheForUser(fixtures.users.kevin.id);

    const originalDateNow = Date.now;
    let currentTime = originalDateNow();
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

    mockVerifyApiKey.mockResolvedValue({
      valid: true,
      key: {
        id: 'ba-apicache-ttl-1',
        referenceId: String(fixtures.users.kevin.id),
        permissions: { api: ['READ_MEDIA'] },
        metadata: null,
      },
    });

    const app = createApiKeyApp();
    const firstRes = await request(app).get('/test').set('Authorization', 'Bearer nade_apikey_ttltest');
    expect(firstRes.status).toBe(200);
    expect(mockVerifyApiKey).toHaveBeenCalledTimes(1);

    mockVerifyApiKey.mockClear();

    currentTime += 6 * 60 * 1000;

    mockVerifyApiKey.mockResolvedValue({
      valid: true,
      key: {
        id: 'ba-apicache-ttl-1',
        referenceId: String(fixtures.users.kevin.id),
        permissions: { api: ['READ_MEDIA'] },
        metadata: null,
      },
    });

    const secondRes = await request(app).get('/test').set('Authorization', 'Bearer nade_apikey_ttltest');
    expect(secondRes.status).toBe(200);

    expect(mockVerifyApiKey).toHaveBeenCalledTimes(1);

    vi.spyOn(Date, 'now').mockRestore();
  });
});

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
