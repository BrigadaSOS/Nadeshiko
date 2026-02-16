import { ApiPermission, User, UserRoleType } from '@app/models';
import { config } from '@config/config';
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

const isProduction = isProdEnvironment();
const trustedOrigins = config.ALLOWED_WEBSITE_URLS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const socialProviders: Record<string, Record<string, unknown>> = {};

if (config.ID_OAUTH_GOOGLE && config.SECRET_OAUTH_GOOGLE) {
  socialProviders.google = {
    clientId: config.ID_OAUTH_GOOGLE,
    clientSecret: config.SECRET_OAUTH_GOOGLE,
    disableSignUp: false,
    disableImplicitSignUp: false,
  };
}

if (config.DISCORD_CLIENT_ID && config.DISCORD_CLIENT_SECRET) {
  socialProviders.discord = {
    clientId: config.DISCORD_CLIENT_ID,
    clientSecret: config.DISCORD_CLIENT_SECRET,
    disableSignUp: false,
    disableImplicitSignUp: false,
  };
}

export const BETTER_AUTH_SESSION_COOKIE = 'nadeshiko.session_token';
export const BETTER_AUTH_SESSION_COOKIE_ALIASES = [
  BETTER_AUTH_SESSION_COOKIE,
  `__Secure-${BETTER_AUTH_SESSION_COOKIE}`,
  `__Host-${BETTER_AUTH_SESSION_COOKIE}`,
];
export const BETTER_AUTH_API_PERMISSION_RESOURCE = 'api';

export const auth = betterAuth({
  basePath: '/v1/auth',
  baseURL: config.BASE_URL,
  database: pool,
  trustedOrigins: trustedOrigins.length > 0 ? trustedOrigins : undefined,
  disabledPaths: [
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
  ],
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
        timeWindow: config.API_KEY_RATE_LIMIT_WINDOW_MS,
        maxRequests: config.API_KEY_RATE_LIMIT_MAX,
      },
      customAPIKeyGetter: (ctx) => {
        const authorization = ctx.headers?.get('authorization');
        if (!authorization || !authorization.startsWith('Bearer ')) {
          return null;
        }

        const token = authorization.slice('Bearer '.length).trim();
        return token.length > 0 ? token : null;
      },
      permissions: {
        defaultPermissions: async (userId) => {
          const numericUserId = Number(userId);
          const defaultReadOnly = [ApiPermission.READ_MEDIA];

          if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
            return {
              [BETTER_AUTH_API_PERMISSION_RESOURCE]: defaultReadOnly,
            };
          }

          const user = await User.findOne({
            where: { id: numericUserId },
          });
          const isAdmin = user?.role === UserRoleType.ADMIN;

          return {
            [BETTER_AUTH_API_PERMISSION_RESOURCE]: isAdmin ? Object.values(ApiPermission) : defaultReadOnly,
          };
        },
      },
    }),
    customSession(async ({ user, session }) => {
      const dbUser = await User.findOne({ where: { id: Number(user.id) } });
      return {
        user: {
          ...user,
          role: dbUser?.role ?? UserRoleType.USER,
          preferences: dbUser?.preferences ?? {},
        },
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
        after: async (user) => {
          // Send welcome email to new users
          if (user.email && user.name && user.id) {
            try {
              await sendWelcomeEmail(Number(user.id), user.name, user.email);
            } catch (error) {
              // Log error but don't fail user creation
              console.error('Failed to send welcome email:', error);
            }
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
});
