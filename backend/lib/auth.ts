import { UserRole } from '@app/entities';
import { betterAuth } from 'better-auth';
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
});

const isProduction = process.env.ENVIRONMENT === 'production';
const cookieDomain = process.env.COOKIE_DOMAIN?.trim();
const resolvedCookieDomain = cookieDomain && cookieDomain !== 'localhost' ? cookieDomain : undefined;
const trustedOrigins = (process.env.ALLOWED_WEBSITE_URLS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const socialProviders: Record<string, Record<string, unknown>> = {};

if (process.env.ID_OAUTH_GOOGLE && process.env.SECRET_OAUTH_GOOGLE) {
  socialProviders.google = {
    clientId: process.env.ID_OAUTH_GOOGLE,
    clientSecret: process.env.SECRET_OAUTH_GOOGLE,
    redirectURI: process.env.URI_ALLOWED_GOOGLE || undefined,
    // Only pre-imported users are allowed to authenticate.
    disableSignUp: true,
    disableImplicitSignUp: true,
  };
}

if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
  socialProviders.discord = {
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    redirectURI: process.env.DISCORD_REDIRECT_URI || undefined,
    disableSignUp: true,
    disableImplicitSignUp: true,
  };
}

export const BETTER_AUTH_SESSION_COOKIE = 'nadeshiko.session_token';
export const BETTER_AUTH_SESSION_COOKIE_ALIASES = [
  BETTER_AUTH_SESSION_COOKIE,
  `__Secure-${BETTER_AUTH_SESSION_COOKIE}`,
  `__Host-${BETTER_AUTH_SESSION_COOKIE}`,
];

export const auth = betterAuth({
  basePath: '/api/auth',
  baseURL: process.env.BASE_URL,
  database: pool,
  trustedOrigins: trustedOrigins.length > 0 ? trustedOrigins : undefined,
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
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Preserve current role behavior: every newly created user gets role 3.
          const existingRole = await UserRole.findOne({
            where: { userId: Number(user.id), roleId: 3 },
          });
          if (!existingRole) {
            await UserRole.insert({
              userId: Number(user.id),
              roleId: 3,
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
      ...(resolvedCookieDomain ? { domain: resolvedCookieDomain } : {}),
    },
  },
});
