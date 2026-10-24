import { ApiPermission, ShirabeConnection, User, UserRoleType } from '@app/models';
import { captureAccountCreated } from '@app/services/analytics/posthog';
import { config, type AppConfig } from '@config/config';
import { isProdEnvironment } from '@config/environment';
import { getAppPostgresConfig } from '@config/postgresConfig';
import { sendWelcomeEmail, sendVerifyNewEmail, sendMagicLinkEmail } from '@app/mailers/email';
import { ensureDefaultCollections } from '@app/controllers/collectionController';
import { betterAuth } from 'better-auth';
import { apiKey } from '@better-auth/api-key';
import { admin, createAccessControl, customSession, emailOTP, magicLink } from 'better-auth/plugins';
import { Pool } from 'pg';
import { logger } from '@config/log';
import {
  LOGIN_CODE_LENGTH,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_TTL_MS,
  generateLoginCode,
} from '@app/services/auth/loginCode';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { isSuppressed } from '@app/services/email/suppression';
import { countryFromAuthContext } from '@app/services/auth/requestCountry';
import { recordLastSeen, resolveUserId, shouldRecordLastSeen } from '@app/services/auth/lastSeen';
import { Cache, createCacheNamespace } from '@lib/cache';
import { refreshIfStale, stackIsStale } from '@app/services/shirabe/connection';

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
  // The email-OTP plugin is here only for `/sign-in/email-otp`; codes are minted in-process via `auth.api`, which
  // `disabledPaths` does not gate. Over HTTP, sending one would overwrite the code already in a reader's inbox.
  '/email-otp/send-verification-otp',
  '/email-otp/check-verification-otp',
  '/email-otp/verify-email',
  '/email-otp/request-password-reset',
  '/email-otp/reset-password',
  '/email-otp/request-email-change',
  '/email-otp/change-email',
  '/forget-password/email-otp',
];

// The old per-user cooldown was replaced by per-address limiting because it could silently return without sending and
// did not cover new addresses.

/** Stash the OTP while better-auth generates it, then send one combined magic-link message; await the stash before
 * reading it, and use the short TTL only as leak protection. */
const LOGIN_CODE_HANDOFF_CACHE = createCacheNamespace('loginCodeHandoff', 10_000);
const LOGIN_CODE_HANDOFF_MS = 60 * 1000;

/** Keep the live auth reference module-local to avoid a circular import; expose only the OTP call through a minimal
 * structural type. */
let authInstance: {
  api: {
    sendVerificationOTP: (args: { body: { email: string; type: 'sign-in' } }) => Promise<unknown>;
    getSession: (args: {
      headers: Headers;
      query: { disableCookieCache: boolean; disableRefresh: boolean };
    }) => Promise<{ session?: { createdAt?: Date | string } } | null>;
  };
} | null = null;

// Keep global `freshAge` at zero; apply the short freshness window only to destructive account deletion.
const DELETE_USER_FRESH_AGE_MS = 15 * 60 * 1000;

async function requireRecentDeleteAuthentication(request?: Request): Promise<void> {
  const url = request ? new URL(request.url) : null;
  // Trust freshness only from better-auth’s validated callback token, never a direct-route query parameter.
  if (request?.method === 'GET' && url?.pathname.endsWith('/delete-user/callback') && url.searchParams.get('token'))
    return;

  const result = request
    ? await authInstance?.api.getSession({
        headers: request.headers,
        query: { disableCookieCache: true, disableRefresh: true },
      })
    : null;
  const createdAt = result?.session?.createdAt ? new Date(result.session.createdAt).getTime() : NaN;
  if (!Number.isFinite(createdAt) || Date.now() - createdAt >= DELETE_USER_FRESH_AGE_MS) {
    throw new APIError('BAD_REQUEST', {
      code: 'SESSION_EXPIRED',
      message: 'Recent authentication is required to delete an account.',
    });
  }
}

/** A key minted under impersonation would outlive the 30-minute impersonation session and carry the admin's access
 * into the user's account indefinitely; `/v1/user/api-keys` makes the same check on `req.auth`. */
export async function rejectImpersonatedApiKeyCreation(ctx: {
  path?: string;
  context: Parameters<typeof getSessionFromCtx>[0]['context'];
}): Promise<void> {
  if (ctx.path !== '/api-key/create') return;

  const session = await getSessionFromCtx(ctx as Parameters<typeof getSessionFromCtx>[0]);
  if ((session?.session as { impersonatedBy?: unknown } | undefined)?.impersonatedBy) {
    throw new APIError('FORBIDDEN', {
      code: 'IMPERSONATION_FORBIDDEN',
      message: 'API keys cannot be created while impersonating a user.',
    });
  }
}

/** Keep impersonation duration in one constant because both plugin options and the session-update hook must agree. */
const IMPERSONATION_SESSION_MAX_AGE_MS = 30 * 60 * 1000;

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
  captureAccountCreatedFn?: typeof captureAccountCreatedAfterUserCreate;
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

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function extractBearerToken(authorization: string | undefined | null): string | null {
  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }

  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/** Unscoped keys default to corpus-read only, not the owner’s role: keys are bearer credentials commonly handed to
 * third-party tools, and existing key rows retain their stored permissions. */
const DEFAULT_API_PERMISSIONS = [ApiPermission.READ_MEDIA];

/** This is the server-side ceiling for permissions a user may grant a key; `enforceSessionAdmin` also re-checks the
 * owner's current role for user keys, but a key must never carry a scope its owner could not use. */
const USER_GRANTABLE_API_PERMISSIONS = [
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

/** An admin may additionally grant the corpus writes their role already allows. */
const ADMIN_GRANTABLE_API_PERMISSIONS = [
  ...USER_GRANTABLE_API_PERMISSIONS,
  ApiPermission.ADD_MEDIA,
  ApiPermission.UPDATE_MEDIA,
  ApiPermission.REMOVE_MEDIA,
];

/** No user argument: the grantable-permissions answer is independent of the requester, and retaining one would
 * invite role-dependent behavior and an unnecessary DB read. */
export function resolveDefaultApiPermissions(): Record<string, ApiPermission[]> {
  return {
    [BETTER_AUTH_API_PERMISSION_RESOURCE]: DEFAULT_API_PERMISSIONS,
  };
}

/** Every scope this user is allowed to put on a key, by role. */
export async function resolveGrantableApiPermissions(
  userId: number,
  findUserById: FindUserById = defaultFindUserById,
): Promise<ApiPermission[]> {
  const user = await findUserById(userId);
  return user?.role === UserRoleType.ADMIN ? ADMIN_GRANTABLE_API_PERMISSIONS : USER_GRANTABLE_API_PERMISSIONS;
}

/** Preferences ride the session because `customSession` reloads them even on cookie-cache hits and the frontend
 * already caches them with session data; this removes a sequential SSR request. Missing rows return `{}` so
 * defaults apply. */
export async function enrichSessionUser(user: BetterAuthSessionUser, findUserById: FindUserById = defaultFindUserById) {
  const dbUser = await findUserById(Number(user.id));
  return {
    ...user,
    role: dbUser?.role ?? UserRoleType.USER,
    preferences: dbUser?.preferences ?? {},
    shirabe: await sessionShirabe(Number(user.id)),
  };
}

/** Expose linked-state on every session for lookup-cache isolation; include a per-reader fingerprint for browser
 * invalidation, derive ordered supported languages from the stack, keep credentials server-only, and fail closed to
 * “not linked”. */
function glossLanguagesFrom(stack: string[] | null | undefined): string[] {
  const ordered = (stack ?? [])
    .map((source) => source.slice(source.lastIndexOf(':') + 1).toLowerCase())
    .filter((language) => language === 'en' || language === 'es');

  return [...new Set(ordered)];
}

async function sessionShirabe(userId: number) {
  if (!Number.isInteger(userId) || userId <= 0) return null;

  try {
    // Two columns rather than an existence check, because the fingerprint is
    // wanted on the same rows and a second query for it would be a round trip
    // per render.
    const connection = await ShirabeConnection.findOne({
      where: { userId },
      select: { id: true, stackFingerprint: true, stack: true, disconnectedAt: true, syncedAt: true },
    });
    if (!connection) return null;

    // Refresh stale linked stacks fire-and-forget: refresh dedupes and never blocks session reads, while a successful
    // read clears a prior disconnected mark before that check.
    if (stackIsStale(connection.syncedAt)) void refreshIfStale(userId);

    /** A refused Shirabe key is not linked: leaving `linked` true would trigger doomed credential/lookups on every
     * word, while the settings row remains for repair guidance. */
    if (connection.disconnectedAt) return null;

    return {
      linked: true,
      stackFingerprint: connection.stackFingerprint ?? null,
      glossLanguages: glossLanguagesFrom(connection.stack),
    };
  } catch (error) {
    logger.warn({ err: error, userId }, 'Could not read the Shirabe connection for a session');
    return null;
  }
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

/** Report signup server-side once per persisted row, separately from the browser event; analytics is guarded so it
 * can never fail signup. */
export function captureAccountCreatedAfterUserCreate(
  user: BetterAuthCreatedUser,
  captureFn: typeof captureAccountCreated = captureAccountCreated,
) {
  if (!user.id) {
    return;
  }

  // Narrow `createdAt`; invalid values fall back to now instead of throwing during signup.
  const createdAt = user.createdAt;
  // Narrow hook fields instead of asserting them; invalid or blank name/email values must not overwrite an existing
  // browser identity or produce PostHog’s `(unknown)`.
  const trimmedName = typeof user.name === 'string' ? user.name.trim() : '';
  const trimmedEmail = typeof user.email === 'string' ? user.email.trim() : '';
  const name = trimmedName.length > 0 ? trimmedName : null;
  const email = trimmedEmail.length > 0 ? trimmedEmail : null;

  captureFn({
    userId: String(user.id),
    createdAt: createdAt instanceof Date || typeof createdAt === 'string' ? createdAt : undefined,
    name,
    email,
  });
}

export function buildAuthOptions(dependencies: BuildAuthOptionsDependencies = {}): BetterAuthOptions {
  const configValues = dependencies.configValues || config;
  const databasePool = dependencies.databasePool || pool;
  const isProduction = dependencies.production ?? isProdEnvironment(configValues.ENVIRONMENT);
  // Key on the served scheme, not the environment name: staging runs ENVIRONMENT=development behind https.
  const secureCookies = isProduction || isHttpsUrl(configValues.BASE_URL);
  const findUserById = dependencies.findUserById || defaultFindUserById;
  const sendWelcomeEmailFn = dependencies.sendWelcomeEmailFn || sendWelcomeEmail;
  const sendVerifyNewEmailFn = dependencies.sendVerifyNewEmailFn || sendVerifyNewEmail;
  const sendMagicLinkEmailFn = dependencies.sendMagicLinkEmailFn || sendMagicLinkEmail;
  const onWelcomeEmailError = dependencies.onWelcomeEmailError || defaultWelcomeEmailErrorLogger;
  const ensureDefaultCollectionsFn = dependencies.ensureDefaultCollectionsFn || ensureDefaultCollections;
  const captureAccountCreatedFn = dependencies.captureAccountCreatedFn || captureAccountCreatedAfterUserCreate;

  const trustedOrigins = getTrustedOrigins(configValues.ALLOWED_WEBSITE_URLS);
  const socialProviders = buildSocialProviders(configValues);

  return {
    secret: configValues.BETTER_AUTH_SECRET,
    basePath: '/v1/auth',
    baseURL: configValues.BASE_URL,
    database: databasePool,
    trustedOrigins: trustedOrigins.length > 0 ? trustedOrigins : undefined,
    disabledPaths: DISABLED_PATHS,
    hooks: {
      before: createAuthMiddleware(rejectImpersonatedApiKeyCreation),
    },
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
        // Set `input: false` so signup country comes only from the request header, not caller-supplied body data.
        signupCountry: { type: 'string', fieldName: 'signup_country', required: false, input: false },
      },
      changeEmail: {
        enabled: true,
      },
      deleteUser: {
        enabled: true,
        beforeDelete: async (_user, request) => requireRecentDeleteAuthentication(request),
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
      additionalFields: {
        // Keep this edge-derived field `input: false` for the same reason as `signupCountry`.
        country: { type: 'string', fieldName: 'country', required: false, input: false },
      },
      // The 90-day session value is independent of dormancy now; check `DORMANT_AFTER_DAYS` before changing it because
      // the old coupling changed win-back timing.
      expiresIn: 90 * 24 * 60 * 60,
      updateAge: 7 * 24 * 60 * 60,
      // Disable global `freshAge`: it breaks the session-list endpoint for ordinary 90-day sessions, while delete-user
      // has its own 15-minute freshness guard.
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
        impersonationSessionDuration: IMPERSONATION_SESSION_MAX_AGE_MS / 1000,
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
      /** Only stash the sign-in OTP; `sendVerificationOTP` sends nothing because the combined magic-link message
       * carries it, and unsupported flow types must not be swallowed silently. */
      emailOTP({
        otpLength: LOGIN_CODE_LENGTH,
        expiresIn: LOGIN_CODE_TTL_MS / 1000,
        allowedAttempts: LOGIN_CODE_MAX_ATTEMPTS,
        // Hashed, like every other credential we hold: a database dump must not
        // be a list of live sign-in codes.
        storeOTP: 'hashed',
        disableSignUp: false,
        generateOTP: () => generateLoginCode(),
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type !== 'sign-in') return;
          Cache.set(LOGIN_CODE_HANDOFF_CACHE, email.trim().toLowerCase(), otp, LOGIN_CODE_HANDOFF_MS);
        },
      }),
      magicLink({
        expiresIn: 15 * 60,
        // Use a loose per-IP limit because shared IPs are not people; the tighter per-address limiter supplies the
        // per-person budget. This depends on `advanced.ipAddress` resolving the real client.
        rateLimit: { window: 60 * 60, max: 60 },
        sendMagicLink: async ({ email, url }) => {
          // Reject suppressed addresses explicitly rather than letting mail sending succeed invisibly; the small
          // enumeration trade prevents a reader from being trapped on a sign-in path with no arriving message.
          if (await isSuppressed(email)) {
            throw new APIError('BAD_REQUEST', {
              code: 'EMAIL_UNDELIVERABLE',
              message:
                'We cannot deliver email to that address: a previous message bounced or was reported as spam. Please use a different address.',
            });
          }

          // Mint the code only after suppression/cooldown checks, so an unsent code is never left live.
          await sendMagicLinkEmailFn(email, url, await mintLoginCode(email));
        },
      }),
      apiKey({
        apiKeyHeaders: 'authorization',
        defaultPrefix: 'nade_',
        // Match POST /v1/user/api-keys: labels up to 100 characters are valid.
        maximumNameLength: 100,
        rateLimit: {
          enabled: true,
          timeWindow: configValues.API_KEY_RATE_LIMIT_WINDOW_MS,
          maxRequests: configValues.API_KEY_RATE_LIMIT_MAX,
        },
        customAPIKeyGetter: (ctx) => extractBearerToken(ctx.headers?.get('authorization')),
        permissions: {
          defaultPermissions: () => resolveDefaultApiPermissions(),
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
        /** Capture `CF-IPCountry` from the same request context as IP/user-agent, but never block sign-in: absent
         * headers store null. */
        create: {
          before: async (data, context) => {
            const country = countryFromAuthContext(context);
            if (!country) return;

            return { data: { ...data, country } };
          },
          /** Record last-seen in an after-hook so a convenience-column failure cannot roll back or fail the sign-in
           * that created the session. */
          after: async (session, context) => {
            if (!shouldRecordLastSeen(session)) return;

            await recordLastSeen(resolveUserId(session) as number, countryFromAuthContext(context));
          },
        },
        /** Cap impersonation refreshes at the admin plugin’s short duration. Ordinary refreshes skip this path; do
         * not return `false`, because the caller treats a null update as a dead session and signs the reader out. */
        update: {
          before: async (data, context) => {
            const active = context?.context.session;
            if (!active?.session.impersonatedBy) return;

            const createdAt = new Date(active.session.createdAt).getTime();
            if (!Number.isFinite(createdAt)) return;

            return { data: { ...data, expiresAt: new Date(createdAt + IMPERSONATION_SESSION_MAX_AGE_MS) } };
          },
          /** Record ordinary refresh activity at most once per seven-day `updateAge`; filter impersonation with the
           * same predicate as the create hook. */
          after: async (session, context) => {
            if (!shouldRecordLastSeen(session)) return;

            await recordLastSeen(resolveUserId(session) as number, countryFromAuthContext(context));
          },
        },
      },
      user: {
        create: {
          before: async (user, context) => {
            const name = (
              user.name?.trim() ||
              (user.email ? (user.email.split('@')[0] ?? '').replace(/[^a-zA-Z0-9_]/g, '') || 'user' : 'user')
            ).slice(0, 30);
            // Let each signup flow own `emailVerified`; record `signupCountry` only in this creation hook because the
            // consumed verification row is then gone, and keep later location in `session.country`.
            const signupCountry = countryFromAuthContext(context);

            return {
              data: {
                ...user,
                name,
                ...(signupCountry ? { signupCountry } : {}),
              },
            };
          },
          after: async (user) => {
            // Enqueue analytics synchronously before later awaits; mail/database failures must not lose the only signup
            // record.
            captureAccountCreatedFn(user as BetterAuthCreatedUser);

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
      /** Configure better-auth with the real client-IP header: without trusted proxy handling, the forwarded chain
       * collapses the whole site into one limiter bucket. Prefer Cloudflare’s single `cf-connecting-ip`, with
       * forwarded-for as fallback. */
      ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'],
      },
      database: {
        generateId: 'serial',
      },
      cookiePrefix: 'nadeshiko',
      useSecureCookies: secureCookies,
      defaultCookieAttributes: {
        sameSite: 'lax',
        secure: secureCookies,
      },
    },
  } as BetterAuthOptions;
}

/** Return null when the optional sign-in code cannot be minted: the magic link remains the primary sign-in path, so
 * a code failure must not suppress the email. */
async function mintLoginCode(email: string): Promise<string | null> {
  const key = email.trim().toLowerCase();

  try {
    await authInstance?.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
    return Cache.get<string>(LOGIN_CODE_HANDOFF_CACHE, key);
  } catch (error) {
    logger.warn({ err: error }, 'Could not mint a sign-in code; sending the link on its own');
    return null;
  } finally {
    // Read once. Left behind it would be a plaintext credential sitting in
    // memory for a minute after the only thing that needed it has finished.
    Cache.delete(LOGIN_CODE_HANDOFF_CACHE, key);
  }
}

export const auth = betterAuth(buildAuthOptions());
// Cast only the email-OTP endpoint absent from the widened `BetterAuthOptions` type.
authInstance = auth as unknown as typeof authInstance;
