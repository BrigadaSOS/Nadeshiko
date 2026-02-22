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

    expect(invalid).toEqual({ [BETTER_AUTH_API_PERMISSION_RESOURCE]: [ApiPermission.READ_MEDIA] });
    expect(zero).toEqual({ [BETTER_AUTH_API_PERMISSION_RESOURCE]: [ApiPermission.READ_MEDIA] });
  });

  it('returns full permissions for admin users', async () => {
    const findUserById = vi.fn(async () => ({ role: UserRoleType.ADMIN } as any));
    const result = await resolveDefaultApiPermissions('42', findUserById as any);

    expect(findUserById).toHaveBeenCalledWith(42);
    expect(result[BETTER_AUTH_API_PERMISSION_RESOURCE]).toEqual(Object.values(ApiPermission));
  });

  it('returns readonly permissions for non-admin users', async () => {
    const findUserById = vi.fn(async () => ({ role: UserRoleType.USER } as any));
    const result = await resolveDefaultApiPermissions('42', findUserById as any);

    expect(result[BETTER_AUTH_API_PERMISSION_RESOURCE]).toEqual([ApiPermission.READ_MEDIA]);
  });
});

describe('enrichSessionUser', () => {
  it('adds role and preferences from database user', async () => {
    const findUserById = vi.fn(async () => ({ role: UserRoleType.ADMIN, preferences: { locale: 'ja' } } as any));
    const user = await enrichSessionUser({ id: '9', email: 'u@test.local' }, findUserById as any);

    expect(findUserById).toHaveBeenCalledWith(9);
    expect(user).toMatchObject({
      id: '9',
      role: UserRoleType.ADMIN,
      preferences: { locale: 'ja' },
    });
  });

  it('falls back to USER role and empty preferences when DB user is missing', async () => {
    const findUserById = vi.fn(async () => null);
    const user = await enrichSessionUser({ id: '10' }, findUserById as any);

    expect(user).toMatchObject({
      id: '10',
      role: UserRoleType.USER,
      preferences: {},
    });
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
