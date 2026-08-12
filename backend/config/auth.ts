import { ApiPermission, User, UserRoleType } from '@app/models';
import { config, type AppConfig } from '@config/config';
import { isProdEnvironment } from '@config/environment';
import { getAppPostgresConfig } from '@config/postgresConfig';
import { sendWelcomeEmail, sendVerifyNewEmail, sendMagicLinkEmail } from '@app/mailers/email';
import { ensureDefaultCollections } from '@app/controllers/collectionController';
import { betterAuth } from 'better-auth';
import { apiKey } from '@better-auth/api-key';
import { admin, createAccessControl, customSession, magicLink } from 'better-auth/plugins';
import { Pool } from 'pg';
import { logger } from '@config/log';
import { Cache, createCacheNamespace } from '@lib/cache';

const postgres = getAppPostgresConfig();

const pool = new Pool({
  host: postgres.host,
  port: postgres.port,
  user: postgres.user,
  password: postgres.password,
  database: postgres.database,
});

export const BETTER_AUTH_API_PERMISSION_RESOURCE = 'api';

const DISABLED_PATHS = [
  '/send-verification-email',
  '/update-user',
  '/delete-user/callback',
  '/link-social',
  '/list-accounts',
  '/unlink-account',
  '/refresh-token',
  '/get-access-token',
  '/account-info',
  '/sign-up/email',
  '/reset-password',
  '/forget-password',
];

// Tracked in the shared cache rather than a bare Map so entries expire with the
// cooldown instead of accumulating one permanent row per user who ever
// requested a magic link, and so the namespace stays within an entry cap.
const MAGIC_LINK_COOLDOWN_CACHE = createCacheNamespace('magicLinkCooldown', 10_000);
const MAGIC_LINK_COOLDOWN_MS = 14 * 60 * 1000;

const adminAc = createAccessControl({
  user: [
    'create',
    'list',
    'set-role',
    'ban',
    'impersonate',
    'impersonate-admins',
    'delete',
    'set-password',
    'get',
    'update',
  ],
  session: ['list', 'revoke', 'delete'],
});

const pluginRoles = {
  [UserRoleType.ADMIN]: adminAc.newRole({
    user: ['create', 'list', 'set-role', 'ban', 'impersonate', 'delete', 'set-password', 'get', 'update'],
    session: ['list', 'revoke', 'delete'],
  }),
  [UserRoleType.MOD]: adminAc.newRole({ user: [], session: [] }),
  [UserRoleType.USER]: adminAc.newRole({ user: [], session: [] }),
  [UserRoleType.PATREON]: adminAc.newRole({ user: [], session: [] }),
};

type BetterAuthOptions = Parameters<typeof betterAuth>[0];
type BetterAuthSessionUser = {
  id: string | number;
  [key: string]: unknown;
};
type BetterAuthCreatedUser = {
  id?: string | number | null;
  name?: string | null;
  email?: string | null;
  [key: string]: unknown;
};
type FindUserById = (id: number) => Promise<User | null>;
type WelcomeEmailErrorLogger = (error: unknown) => void;

const defaultFindUserById: FindUserById = (id) => User.findOne({ where: { id } });
const defaultWelcomeEmailErrorLogger: WelcomeEmailErrorLogger = (error) => {
  logger.error({ err: error }, 'Failed to send welcome email');
};

interface BuildAuthOptionsDependencies {
  configValues?: AppConfig;
  databasePool?: Pool;
  production?: boolean;
  findUserById?: FindUserById;
  sendWelcomeEmailFn?: typeof sendWelcomeEmail;
  sendVerifyNewEmailFn?: typeof sendVerifyNewEmail;
  sendMagicLinkEmailFn?: typeof sendMagicLinkEmail;
  onWelcomeEmailError?: WelcomeEmailErrorLogger;
  ensureDefaultCollectionsFn?: typeof ensureDefaultCollections;
}

export function getTrustedOrigins(allowedWebsiteUrls: string): string[] {
  return allowedWebsiteUrls
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function buildSocialProviders(configValues: AppConfig): Record<string, Record<string, unknown>> {
  const socialProviders: Record<string, Record<string, unknown>> = {};

  if (configValues.ID_OAUTH_GOOGLE && configValues.SECRET_OAUTH_GOOGLE) {
    socialProviders.google = {
      clientId: configValues.ID_OAUTH_GOOGLE,
      clientSecret: configValues.SECRET_OAUTH_GOOGLE,
      disableSignUp: false,
      disableImplicitSignUp: false,
    };
  }

  if (configValues.DISCORD_CLIENT_ID && configValues.DISCORD_CLIENT_SECRET) {
    socialProviders.discord = {
      clientId: configValues.DISCORD_CLIENT_ID,
      clientSecret: configValues.DISCORD_CLIENT_SECRET,
      disableSignUp: false,
      disableImplicitSignUp: false,
    };
  }

  return socialProviders;
}

export function extractBearerToken(authorization: string | undefined | null): string | null {
  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }

  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

const DEFAULT_USER_API_PERMISSIONS = [
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

/**
 * An admin's key can rewrite the shared media corpus, so being an admin is a
 * reason to grant less by default rather than more: a key created without an
 * explicit scope list can only read. Corpus writes have to be asked for.
 */
const DEFAULT_ADMIN_API_PERMISSIONS = [
  ApiPermission.READ_MEDIA,
  ApiPermission.READ_PROFILE,
  ApiPermission.READ_ACTIVITY,
  ApiPermission.READ_COLLECTIONS,
];

export async function resolveDefaultApiPermissions(
  userId: string,
  findUserById: FindUserById = defaultFindUserById,
): Promise<Record<string, ApiPermission[]>> {
  const numericUserId = Number(userId);

  if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
    return {
      [BETTER_AUTH_API_PERMISSION_RESOURCE]: DEFAULT_USER_API_PERMISSIONS,
    };
  }

  const user = await findUserById(numericUserId);
  const isAdmin = user?.role === UserRoleType.ADMIN;

  return {
    [BETTER_AUTH_API_PERMISSION_RESOURCE]: isAdmin ? DEFAULT_ADMIN_API_PERMISSIONS : DEFAULT_USER_API_PERMISSIONS,
  };
}

export async function enrichSessionUser(user: BetterAuthSessionUser, findUserById: FindUserById = defaultFindUserById) {
  const dbUser = await findUserById(Number(user.id));
  return {
    ...user,
    role: dbUser?.role ?? UserRoleType.USER,
  };
}

export async function sendWelcomeEmailAfterUserCreate(
  user: BetterAuthCreatedUser,
  sendWelcomeEmailFn: typeof sendWelcomeEmail = sendWelcomeEmail,
  onError: WelcomeEmailErrorLogger = defaultWelcomeEmailErrorLogger,
) {
  if (!user.email || !user.name || !user.id) {
    return;
  }

  try {
    await sendWelcomeEmailFn(Number(user.id), user.name, user.email);
  } catch (error) {
    onError(error);
  }
}

export function buildAuthOptions(dependencies: BuildAuthOptionsDependencies = {}): BetterAuthOptions {
  const configValues = dependencies.configValues || config;
  const databasePool = dependencies.databasePool || pool;
  const isProduction = dependencies.production ?? isProdEnvironment(configValues.ENVIRONMENT);
  const findUserById = dependencies.findUserById || defaultFindUserById;
  const sendWelcomeEmailFn = dependencies.sendWelcomeEmailFn || sendWelcomeEmail;
  const sendVerifyNewEmailFn = dependencies.sendVerifyNewEmailFn || sendVerifyNewEmail;
  const sendMagicLinkEmailFn = dependencies.sendMagicLinkEmailFn || sendMagicLinkEmail;
  const onWelcomeEmailError = dependencies.onWelcomeEmailError || defaultWelcomeEmailErrorLogger;
  const ensureDefaultCollectionsFn = dependencies.ensureDefaultCollectionsFn || ensureDefaultCollections;

  const trustedOrigins = getTrustedOrigins(configValues.ALLOWED_WEBSITE_URLS);
  const socialProviders = buildSocialProviders(configValues);

  return {
    secret: configValues.BETTER_AUTH_SECRET,
    basePath: '/v1/auth',
    baseURL: configValues.BASE_URL,
    database: databasePool,
    trustedOrigins: trustedOrigins.length > 0 ? trustedOrigins : undefined,
    disabledPaths: DISABLED_PATHS,
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await sendVerifyNewEmailFn(user.email, url);
      },
    },
    emailAndPassword: {
      enabled: true,
    },
    socialProviders,
    user: {
      modelName: 'User',
      fields: {
        name: 'username',
        emailVerified: 'is_verified',
        image: 'image',
        createdAt: 'created_at',
        updatedAt: 'modified_at',
      },
      additionalFields: {
        isActive: { type: 'boolean', fieldName: 'is_active', defaultValue: true },
        role: { type: 'string', fieldName: 'role', defaultValue: 'USER' },
      },
      changeEmail: {
        enabled: true,
      },
      deleteUser: {
        enabled: true,
      },
    },
    session: {
      modelName: 'session',
      fields: {
        token: 'token',
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      expiresIn: 30 * 24 * 60 * 60,
      updateAge: 7 * 24 * 60 * 60,
      // OFF DELIBERATELY, and it has to be off for the account page to work.
      //
      // better-auth's `freshSessionMiddleware` 403s (SESSION_NOT_FRESH) once a
      // session is older than `freshAge`, which defaults to 24h. Sessions here
      // live 30 days, so with the default every reader who logged in yesterday
      // got a 403 -- and the only endpoint we expose that uses that middleware
      // is `/list-sessions`, the one behind "active sessions" in settings. The
      // panel was therefore broken for essentially everyone except people who
      // had just signed in.
      //
      // The other consumer of the middleware is `/unlink-account`, which is in
      // DISABLED_PATHS above, so this setting reaches exactly one route. There
      // is nothing to protect there either: listing your own sessions is a read
      // of your own data, not a sensitive mutation. The operations freshness is
      // meant to gate (delete-user, change-email) do not use this middleware --
      // check that again before raising this above 0.
      freshAge: 0,
      storeSessionInDatabase: true,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    account: {
      modelName: 'account',
      fields: {
        accountId: 'account_id',
        providerId: 'provider_id',
        userId: 'user_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        idToken: 'id_token',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'verification',
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    plugins: [
      admin({
        defaultRole: UserRoleType.USER,
        adminRoles: [UserRoleType.ADMIN],
        impersonationSessionDuration: 30 * 60,
        ac: adminAc,
        roles: pluginRoles,
        schema: {
          session: {
            fields: { impersonatedBy: 'impersonated_by' },
          },
          user: {
            fields: {
              banned: 'banned',
              banReason: 'ban_reason',
              banExpires: 'ban_expires',
            },
          },
        },
      }),
      magicLink({
        expiresIn: 15 * 60,
        rateLimit: { window: 5 * 60, max: 3 },
        sendMagicLink: async ({ email, url }) => {
          const existingUser = await User.findOne({ where: { email } });
          if (existingUser) {
            const cooldownKey = String(existingUser.id);
            // A live entry means a link went out within the cooldown window.
            if (Cache.get<true>(MAGIC_LINK_COOLDOWN_CACHE, cooldownKey)) {
              return;
            }
            Cache.set(MAGIC_LINK_COOLDOWN_CACHE, cooldownKey, true, MAGIC_LINK_COOLDOWN_MS);
          }
          await sendMagicLinkEmailFn(email, url);
        },
      }),
      apiKey({
        apiKeyHeaders: 'authorization',
        defaultPrefix: 'nade_',
        rateLimit: {
          enabled: true,
          timeWindow: configValues.API_KEY_RATE_LIMIT_WINDOW_MS,
          maxRequests: configValues.API_KEY_RATE_LIMIT_MAX,
        },
        customAPIKeyGetter: (ctx) => extractBearerToken(ctx.headers?.get('authorization')),
        permissions: {
          defaultPermissions: (userId) => resolveDefaultApiPermissions(userId, findUserById),
        },
      }),
      customSession(async ({ user, session }) => {
        return {
          user: await enrichSessionUser(user as BetterAuthSessionUser, findUserById),
          session,
        };
      }),
    ],
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const userId = Number(session.userId);
            if (!Number.isInteger(userId) || userId <= 0) return;

            const user = await findUserById(userId);
            if (user?.role !== UserRoleType.ADMIN) return;

            return {
              data: {
                ...session,
                expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
              },
            };
          },
        },
        delete: {
          after: async (session) => {
            const userId = Number(session.userId);
            if (Number.isInteger(userId) && userId > 0) {
              Cache.delete(MAGIC_LINK_COOLDOWN_CACHE, String(userId));
            }
          },
        },
      },
      user: {
        create: {
          before: async (user) => {
            const name = (
              user.name?.trim() ||
              (user.email ? (user.email.split('@')[0] ?? '').replace(/[^a-zA-Z0-9_]/g, '') || 'user' : 'user')
            ).slice(0, 30);
            // `emailVerified` is left to the flow that created the account:
            // the magic-link plugin sets it because the link itself proves the
            // address, and OAuth carries the provider's own claim. Forcing it
            // true here would also vouch for email/password sign-ups, which
            // prove nothing (that path is disabled today — see DISABLED_PATHS).
            return {
              data: {
                ...user,
                name,
              },
            };
          },
          after: async (user) => {
            await sendWelcomeEmailAfterUserCreate(
              user as BetterAuthCreatedUser,
              sendWelcomeEmailFn,
              onWelcomeEmailError,
            );
            if (user.id) {
              // Non-fatal: a failure here must not fail the sign-up, but it does
              // leave the account half-provisioned, so it has to be visible.
              await ensureDefaultCollectionsFn(Number(user.id)).catch((error) => {
                logger.error({ err: error, userId: user.id }, 'Failed to create default collections for new user');
              });
            }
          },
        },
      },
    },
    advanced: {
      database: {
        generateId: 'serial',
      },
      cookiePrefix: 'nadeshiko',
      useSecureCookies: isProduction,
      defaultCookieAttributes: {
        sameSite: 'lax',
        secure: isProduction,
      },
    },
  } as BetterAuthOptions;
}

export const auth = betterAuth(buildAuthOptions());
