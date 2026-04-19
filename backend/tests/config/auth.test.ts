import { describe, expect, it, vi } from 'bun:test';
import { ApiPermission, UserRoleType } from '@app/models';
import { config, type AppConfig } from '@config/config';
import {
  BETTER_AUTH_API_PERMISSION_RESOURCE,
  buildAuthOptions,
  buildSocialProviders,
  enrichSessionUser,
  extractBearerToken,
  getTrustedOrigins,
  resolveDefaultApiPermissions,
  sendWelcomeEmailAfterUserCreate,
} from '@config/auth';

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...config,
    ...overrides,
  };
}

describe('auth config helpers', () => {
  it('parses trusted origins by trimming and removing empty values', () => {
    expect(getTrustedOrigins('https://a.test, https://b.test , ,')).toEqual(['https://a.test', 'https://b.test']);
    expect(getTrustedOrigins('')).toEqual([]);
  });

  it('builds social providers only when both credentials are present', () => {
    const googleOnly = buildSocialProviders(
      makeConfig({
        ID_OAUTH_GOOGLE: 'google-id',
        SECRET_OAUTH_GOOGLE: 'google-secret',
        DISCORD_CLIENT_ID: undefined,
        DISCORD_CLIENT_SECRET: undefined,
      }),
    );
    expect(googleOnly.google).toBeDefined();
    expect(googleOnly.discord).toBeUndefined();

    const discordOnly = buildSocialProviders(
      makeConfig({
        ID_OAUTH_GOOGLE: undefined,
        SECRET_OAUTH_GOOGLE: undefined,
        DISCORD_CLIENT_ID: 'discord-id',
        DISCORD_CLIENT_SECRET: 'discord-secret',
      }),
    );
    expect(discordOnly.google).toBeUndefined();
    expect(discordOnly.discord).toBeDefined();
  });

  it('extracts bearer tokens from Authorization header', () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('Basic abc')).toBeNull();
    expect(extractBearerToken('Bearer    ')).toBeNull();
    expect(extractBearerToken('Bearer nade_123')).toBe('nade_123');
  });
});

describe('resolveDefaultApiPermissions', () => {
  it('falls back to readonly permissions for invalid user ids', async () => {
    const invalid = await resolveDefaultApiPermissions('not-a-number');
    const zero = await resolveDefaultApiPermissions('0');

    const defaultPerms = [
      ApiPermission.READ_MEDIA,
      ApiPermission.READ_PROFILE,
      ApiPermission.WRITE_PROFILE,
      ApiPermission.READ_ACTIVITY,
      ApiPermission.WRITE_ACTIVITY,
      ApiPermission.READ_COLLECTIONS,
      ApiPermission.CREATE_COLLECTIONS,
      ApiPermission.UPDATE_COLLECTIONS,
      ApiPermission.DELETE_COLLECTIONS,
    ];
    expect(invalid).toEqual({ [BETTER_AUTH_API_PERMISSION_RESOURCE]: defaultPerms });
    expect(zero).toEqual({ [BETTER_AUTH_API_PERMISSION_RESOURCE]: defaultPerms });
  });

  it('returns full permissions for admin users', async () => {
    const findUserById = vi.fn(async () => ({ role: UserRoleType.ADMIN }) as any);
    const result = await resolveDefaultApiPermissions('42', findUserById as any);

    expect(findUserById).toHaveBeenCalledWith(42);
    expect(result[BETTER_AUTH_API_PERMISSION_RESOURCE]).toEqual(Object.values(ApiPermission));
  });

  it('returns readonly permissions for non-admin users', async () => {
    const findUserById = vi.fn(async () => ({ role: UserRoleType.USER }) as any);
    const result = await resolveDefaultApiPermissions('42', findUserById as any);

    expect(result[BETTER_AUTH_API_PERMISSION_RESOURCE]).toEqual([
      ApiPermission.READ_MEDIA,
      ApiPermission.READ_PROFILE,
      ApiPermission.WRITE_PROFILE,
      ApiPermission.READ_ACTIVITY,
      ApiPermission.WRITE_ACTIVITY,
      ApiPermission.READ_COLLECTIONS,
      ApiPermission.CREATE_COLLECTIONS,
      ApiPermission.UPDATE_COLLECTIONS,
      ApiPermission.DELETE_COLLECTIONS,
    ]);
  });
});

describe('enrichSessionUser', () => {
  it('adds role from database user', async () => {
    const findUserById = vi.fn(async () => ({ role: UserRoleType.ADMIN, preferences: { locale: 'ja' } }) as any);
    const user = await enrichSessionUser({ id: '9', email: 'u@test.local' }, findUserById as any);

    expect(findUserById).toHaveBeenCalledWith(9);
    expect(user).toMatchObject({
      id: '9',
      role: UserRoleType.ADMIN,
    });
    expect(user).not.toHaveProperty('preferences');
  });

  it('falls back to USER role when DB user is missing', async () => {
    const findUserById = vi.fn(async () => null);
    const user = await enrichSessionUser({ id: '10' }, findUserById as any);

    expect(user).toMatchObject({
      id: '10',
      role: UserRoleType.USER,
    });
    expect(user).not.toHaveProperty('preferences');
  });
});

describe('sendWelcomeEmailAfterUserCreate', () => {
  it('skips sending when required fields are missing', async () => {
    const sendWelcomeEmailFn = vi.fn();

    await sendWelcomeEmailAfterUserCreate({ id: 1, email: 'x@test.local' }, sendWelcomeEmailFn as any);
    expect(sendWelcomeEmailFn).not.toHaveBeenCalled();
  });

  it('logs errors and does not rethrow when email sending fails', async () => {
    const sendWelcomeEmailFn = vi.fn(async () => {
      throw new Error('queue down');
    });
    const onError = vi.fn();

    await sendWelcomeEmailAfterUserCreate(
      { id: 1, name: 'user', email: 'user@test.local' },
      sendWelcomeEmailFn as any,
      onError,
    );

    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('buildAuthOptions', () => {
  it('uses undefined trustedOrigins when ALLOWED_WEBSITE_URLS is blank', () => {
    const options = buildAuthOptions({
      configValues: makeConfig({ ALLOWED_WEBSITE_URLS: '' }),
      production: false,
    });

    expect(options.trustedOrigins).toBeUndefined();
    expect((options as any).advanced.useSecureCookies).toBe(false);
    expect((options as any).advanced.defaultCookieAttributes.secure).toBe(false);
  });

  it('maps trusted origins and secure cookie attributes in production', async () => {
    const sendWelcomeEmailFn = vi.fn(async () => undefined);
    const options = buildAuthOptions({
      configValues: makeConfig({
        ALLOWED_WEBSITE_URLS: 'https://a.test,https://b.test',
      }),
      production: true,
      sendWelcomeEmailFn: sendWelcomeEmailFn as any,
      onWelcomeEmailError: vi.fn(),
    });

    expect(options.trustedOrigins).toEqual(['https://a.test', 'https://b.test']);
    expect((options as any).advanced.useSecureCookies).toBe(true);
    expect((options as any).advanced.defaultCookieAttributes.secure).toBe(true);

    const beforeHook = (options as any).databaseHooks.user.create.before;
    const afterHook = (options as any).databaseHooks.user.create.after;

    const beforeResult = await beforeHook({ emailVerified: false, foo: 'bar' });
    expect(beforeResult).toMatchObject({
      data: {
        emailVerified: true,
        foo: 'bar',
      },
    });

    await afterHook({ id: 11, name: 'nadeshiko', email: 'nadeshiko@test.local' });
    expect(sendWelcomeEmailFn).toHaveBeenCalledWith(11, 'nadeshiko', 'nadeshiko@test.local');
  });
});

describe('session duration regression tests', () => {
  const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60; // 2592000
  const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60; // 604800

  it('session expiresIn is at least 30 days to prevent daily logouts', () => {
    const options = buildAuthOptions({
      configValues: makeConfig(),
      production: false,
    });

    const expiresIn = (options as any).session?.expiresIn ?? 0;

    // This should be >= 30 days. If you're shortening this intentionally,
    // make sure you understand the UX impact on daily active users.
    expect(expiresIn).toBeGreaterThanOrEqual(THIRTY_DAYS_IN_SECONDS);
  });

  it('session updateAge allows weekly refresh for rolling sessions', () => {
    const options = buildAuthOptions({
      configValues: makeConfig(),
      production: false,
    });

    const updateAge = (options as any).session?.updateAge ?? 0;

    // updateAge should be >= 7 days. This determines how often active users
    // need to visit to keep their session alive. With 30-day expiresIn,
    // a 7-day updateAge means users visiting weekly get 30-day rolling sessions.
    expect(updateAge).toBeGreaterThanOrEqual(SEVEN_DAYS_IN_SECONDS);
  });

  it('cookieCache is enabled for performance', () => {
    const options = buildAuthOptions({
      configValues: makeConfig(),
      production: false,
    });

    const cookieCache = (options as any).session?.cookieCache;

    expect(cookieCache?.enabled).toBe(true);
    expect(cookieCache?.maxAge).toBeGreaterThanOrEqual(60); // at least 1 minute
  });

  it('session configuration follows security best practices', () => {
    const options = buildAuthOptions({
      configValues: makeConfig(),
      production: true,
    });

    const session = (options as any).session;

    // Sessions should be stored server-side for revocation capability
    expect(session?.storeSessionInDatabase).toBe(true);

    // updateAge should be less than expiresIn (otherwise sessions never refresh)
    expect(session?.updateAge).toBeLessThan(session?.expiresIn);

    // Sanity check: expiresIn should not be unreasonably long (e.g., 1 year)
    // This prevents accidental misconfiguration that would be a security risk
    const NINETY_DAYS_IN_SECONDS = 90 * 24 * 60 * 60;
    expect(session?.expiresIn).toBeLessThanOrEqual(NINETY_DAYS_IN_SECONDS);
  });
});
