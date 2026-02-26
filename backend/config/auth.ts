import { ApiPermission, User, UserRoleType } from '@app/models';
import { config, type AppConfig } from '@config/config';
import { isProdEnvironment } from '@config/environment';
import { getAppPostgresConfig } from '@config/postgresConfig';
import { sendWelcomeEmail } from '@app/mailers/email';
import { betterAuth } from 'better-auth';
import { apiKey, customSession } from 'better-auth/plugins';
import { Pool } from 'pg';

const postgres = getAppPostgresConfig();

const pool = new Pool({
  host: postgres.host,
  port: postgres.port,
  user: postgres.user,
  password: postgres.password,
  database: postgres.database,
});

export const BETTER_AUTH_SESSION_COOKIE = 'nadeshiko.session_token';
export const BETTER_AUTH_SESSION_COOKIE_ALIASES = [
  BETTER_AUTH_SESSION_COOKIE,
  `__Secure-${BETTER_AUTH_SESSION_COOKIE}`,
  `__Host-${BETTER_AUTH_SESSION_COOKIE}`,
];
export const BETTER_AUTH_API_PERMISSION_RESOURCE = 'api';

const DISABLED_PATHS = [
  '/verify-email',
  '/send-verification-email',
  '/change-email',
  '/update-user',
  '/delete-user/callback',
  '/link-social',
  '/list-accounts',
  '/unlink-account',
  '/refresh-token',
  '/get-access-token',
  '/account-info',
];

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
  console.error('Failed to send welcome email:', error);
};

export interface BuildAuthOptionsDependencies {
  configValues?: AppConfig;
  databasePool?: Pool;
  production?: boolean;
  findUserById?: FindUserById;
  sendWelcomeEmailFn?: typeof sendWelcomeEmail;
  onWelcomeEmailError?: WelcomeEmailErrorLogger;
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
  if (!authorization || !authorization.startsWith('Bearer ')) {
    return null;
  }

  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

export async function resolveDefaultApiPermissions(
  userId: string,
  findUserById: FindUserById = defaultFindUserById,
): Promise<Record<string, ApiPermission[]>> {
  const numericUserId = Number(userId);
  const defaultReadOnly = [ApiPermission.READ_MEDIA];

  if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
    return {
      [BETTER_AUTH_API_PERMISSION_RESOURCE]: defaultReadOnly,
    };
  }

  const user = await findUserById(numericUserId);
  const isAdmin = user?.role === UserRoleType.ADMIN;

  return {
    [BETTER_AUTH_API_PERMISSION_RESOURCE]: isAdmin ? Object.values(ApiPermission) : defaultReadOnly,
  };
}

export async function enrichSessionUser(user: BetterAuthSessionUser, findUserById: FindUserById = defaultFindUserById) {
  const dbUser = await findUserById(Number(user.id));
  return {
    ...user,
    role: dbUser?.role ?? UserRoleType.USER,
    preferences: dbUser?.preferences ?? {},
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
  const onWelcomeEmailError = dependencies.onWelcomeEmailError || defaultWelcomeEmailErrorLogger;

  const trustedOrigins = getTrustedOrigins(configValues.ALLOWED_WEBSITE_URLS);
  const socialProviders = buildSocialProviders(configValues);

  return {
    secret: configValues.BETTER_AUTH_SECRET,
    basePath: '/v1/auth',
    baseURL: configValues.BASE_URL,
    database: databasePool,
    trustedOrigins: trustedOrigins.length > 0 ? trustedOrigins : undefined,
    disabledPaths: DISABLED_PATHS,
    emailAndPassword: {
      enabled: false,
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
        enabled: false,
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
      expiresIn: 3 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
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
      user: {
        create: {
          before: async (user) => {
            // Provider-only auth: trust provider-sourced emails as verified.
            return {
              data: {
                ...user,
                emailVerified: true,
              },
            };
          },
          after: async (user) =>
            sendWelcomeEmailAfterUserCreate(user as BetterAuthCreatedUser, sendWelcomeEmailFn, onWelcomeEmailError),
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
