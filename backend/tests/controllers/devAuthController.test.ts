import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'bun:test';
import type { Application } from 'express';
import { buildApplication } from '@config/application';
import { AdminRoutes } from '@config/routes';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { auth, BETTER_AUTH_SESSION_COOKIE_ALIASES } from '@config/auth';
import * as environment from '@config/environment';

setupTestSuite();

let app: Application;
let core: CoreFixtures;
const originalAuthContext = (auth as any).$context;
let isLocalEnvironmentSpy: ReturnType<typeof vi.spyOn<typeof environment, 'isLocalEnvironment'>>;

beforeAll(async () => {
  core = await seedCoreFixtures();
  app = buildApplication({
    mountRoutes: (appInstance) => {
      appInstance.use('/', AdminRoutes);
    },
  });
});

beforeEach(() => {
  isLocalEnvironmentSpy = vi.spyOn(environment, 'isLocalEnvironment').mockReturnValue(true);
});

afterEach(() => {
  (auth as any).$context = originalAuthContext;
  vi.restoreAllMocks();
});

function setMockAuthContext(options?: { deleteSessionImpl?: (token: string) => Promise<void> }) {
  const createSession = vi.fn(async () => ({ token: 'raw-session-token' }));
  const deleteSession = vi.fn(options?.deleteSessionImpl ?? (async () => {}));

  (auth as any).$context = Promise.resolve({
    internalAdapter: {
      createSession,
      deleteSession,
    },
    authCookies: {
      sessionToken: {
        name: BETTER_AUTH_SESSION_COOKIE_ALIASES[0],
        attributes: { path: '/', sameSite: 'lax', httpOnly: true },
      },
      sessionData: {
        name: 'nadeshiko.session_data',
        attributes: { path: '/', sameSite: 'lax', httpOnly: true },
      },
    },
    secret: 'abcdefghijklmnopqrstuvwxyz0123456789',
  });

  return { createSession, deleteSession };
}

function getSetCookieHeader(res: request.Response): string[] {
  const value = res.headers['set-cookie'];
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

describe('POST /v1/admin/impersonation', () => {
  it('creates an impersonation session and sets signed session cookie', async () => {
    const { createSession } = setMockAuthContext();

    const res = await request(app)
      .post('/v1/admin/impersonation')
      .set('x-forwarded-for', '203.0.113.10, 10.0.0.1')
      .set('user-agent', 'dev-auth-controller-test')
      .send({ userId: core.users.regular.id });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      message: 'Impersonation session created.',
      user: {
        id: core.users.regular.id,
        username: core.users.regular.username,
        email: core.users.regular.email,
      },
    });
    expect(createSession).toHaveBeenCalledWith(String(core.users.regular.id), false, {
      ipAddress: '203.0.113.10',
      userAgent: 'dev-auth-controller-test',
    });

    const setCookies = getSetCookieHeader(res);
    expect(setCookies.some((cookie) => cookie.startsWith(`${BETTER_AUTH_SESSION_COOKIE_ALIASES[0]}=`))).toBe(true);
    expect(setCookies.some((cookie) => cookie.startsWith('ndk_dev_impersonation=;'))).toBe(true);
  });

  it('falls back to req.ip when x-forwarded-for is missing', async () => {
    const { createSession } = setMockAuthContext();

    const res = await request(app).post('/v1/admin/impersonation').send({ userId: core.users.regular.id });
    expect(res.status).toBe(200);

    const sessionMeta = (createSession as any).mock.calls[0]?.[2] as {
      ipAddress: string | null;
      userAgent: string | null;
    };
    expect(sessionMeta.ipAddress).toBeString();
  });

  it('returns 404 when target user does not exist', async () => {
    setMockAuthContext();

    const res = await request(app).post('/v1/admin/impersonation').send({ userId: 99999999 });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns 403 when local development impersonation is disabled', async () => {
    setMockAuthContext();
    isLocalEnvironmentSpy.mockReturnValue(false);

    const res = await request(app).post('/v1/admin/impersonation').send({ userId: core.users.regular.id });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCESS_DENIED');
  });
});

describe('DELETE /v1/admin/impersonation', () => {
  it('clears impersonation cookies even when no session cookie is present', async () => {
    const { deleteSession } = setMockAuthContext();

    const res = await request(app).delete('/v1/admin/impersonation');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ message: 'Impersonation session cleared.' });
    expect(deleteSession).not.toHaveBeenCalled();

    const setCookies = getSetCookieHeader(res);
    expect(setCookies.some((cookie) => cookie.startsWith(`${BETTER_AUTH_SESSION_COOKIE_ALIASES[0]}=;`))).toBe(true);
    expect(setCookies.some((cookie) => cookie.startsWith('nadeshiko.session_data=;'))).toBe(true);
    expect(setCookies.some((cookie) => cookie.startsWith('ndk_dev_impersonation=;'))).toBe(true);
    for (const alias of BETTER_AUTH_SESSION_COOKIE_ALIASES.slice(1)) {
      expect(setCookies.some((cookie) => cookie.startsWith(`${alias}=;`))).toBe(true);
    }
  });

  it('deletes both payload and signed token when a signed session cookie is present', async () => {
    const { deleteSession } = setMockAuthContext();
    const signedToken = `payload.${'a'.repeat(43)}=`;

    const res = await request(app)
      .delete('/v1/admin/impersonation')
      .set('Cookie', `${BETTER_AUTH_SESSION_COOKIE_ALIASES[1]}=${encodeURIComponent(signedToken)}; foo=bar`);

    expect(res.status).toBe(200);
    expect(deleteSession).toHaveBeenCalledTimes(2);
    expect(deleteSession).toHaveBeenCalledWith('payload');
    expect(deleteSession).toHaveBeenCalledWith(signedToken);
  });

  it('keeps only the original token when signed payload extraction is invalid', async () => {
    const { deleteSession } = setMockAuthContext();
    const invalidSignedToken = 'payload.short-signature';

    const res = await request(app)
      .delete('/v1/admin/impersonation')
      .set('Cookie', `${BETTER_AUTH_SESSION_COOKIE_ALIASES[0]}=${encodeURIComponent(invalidSignedToken)}`);

    expect(res.status).toBe(200);
    expect(deleteSession).toHaveBeenCalledTimes(1);
    expect(deleteSession).toHaveBeenCalledWith(invalidSignedToken);
  });

  it('ignores deleteSession errors and still clears cookies', async () => {
    const { deleteSession } = setMockAuthContext({
      deleteSessionImpl: async () => {
        throw new Error('delete failed');
      },
    });

    const res = await request(app)
      .delete('/v1/admin/impersonation')
      .set('Cookie', `${BETTER_AUTH_SESSION_COOKIE_ALIASES[0]}=plain-token`);

    expect(res.status).toBe(200);
    expect(deleteSession).toHaveBeenCalledTimes(1);
    expect(deleteSession).toHaveBeenCalledWith('plain-token');
  });
});
