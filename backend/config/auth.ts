import { ApiPermission, ShirabeConnection, User, UserRoleType } from '@app/models';
import { captureAccountCreated } from '@app/services/analytics/posthog';
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

export function extractBearerToken(authorization: string | undefined | null): string | null {
  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }

  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * What a key gets when its creator did not choose: the corpus read, and nothing
 * else.
 *
 * A key is a bearer credential that leaves the browser it was created in, and
 * the common destination is now a third-party tool the reader pasted it into.
 * The default therefore answers "what does a key need to be useful to a
 * stranger's app?", not "what is this account allowed to do" -- and the answer
 * is one scope. Reading the owner's own profile, activity or collections is
 * already more than a search integration needs, so it is not given away to
 * someone who never said which of those they wanted.
 *
 * ROLE PLAYS NO PART HERE, deliberately. It used to, so that an admin's
 * unscoped key could not carry the corpus writes their role allows. That
 * distinction now lives in `resolveGrantableApiPermissions` below, which is
 * where it belongs: the ceiling is a question about the OWNER, the default is a
 * question about the KEY. Branching on role in both places meant two answers to
 * maintain and only one of them enforced anything.
 *
 * Existing keys are untouched: better-auth stores the permission list on the
 * key row at creation, so this changes what NEW unscoped keys get and nothing
 * that is already in someone's hands.
 */
const DEFAULT_API_PERMISSIONS = [ApiPermission.READ_MEDIA];

/**
 * The most a user may put on a key, which is a different question from what
 * they get by default and must not be conflated with it.
 *
 * `enforceApiKeyScope` is the ONLY gate on a key-authenticated request --
 * `enforceSessionAdmin` passes straight through for API-key auth -- so this
 * ceiling is what stands between a normal account and the corpus-write scopes.
 * It is enforced server-side in `createUserApiKey`; better-auth's own create
 * endpoint refuses a client-supplied permission list outright, so there is no
 * second door into it.
 */
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

/**
 * Takes no arguments on purpose: the answer no longer depends on who is asking,
 * and a signature that still accepted a user id would invite someone to make it
 * depend on that again. It also drops a database read from every key creation.
 */
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

export async function enrichSessionUser(user: BetterAuthSessionUser, findUserById: FindUserById = defaultFindUserById) {
  const dbUser = await findUserById(Number(user.id));
  return {
    ...user,
    role: dbUser?.role ?? UserRoleType.USER,
    shirabe: await sessionShirabe(Number(user.id)),
  };
}

/**
 * The one thing the frontend needs to know about a linked Shirabe account on
 * EVERY render: whether there is one.
 *
 * It rides the session rather than being fetched on its own because of where it
 * is used. A linked reader's word lookups must not be answered from, or stored
 * in, the cache other readers are served from, and that decision is made before
 * the lookup happens -- so it is needed on every request. The session is already
 * read once per render and cached for a minute by the frontend
 * (server/utils/ssrAuthCache.ts), so this costs one indexed lookup on a request
 * that was happening anyway, instead of a round trip per page.
 *
 * The fingerprint rides along, and it is worth being precise about what for. An
 * earlier version carried it so readers configured IDENTICALLY could share a
 * cached answer, and that sharing was dropped: it bought little and put one
 * reader's dictionaries one mistake away from another's. This is the other job
 * the same value does, and the one that was lost with it -- a linked reader's
 * lookups are cached in THEIR OWN browser for a day, and without something in
 * the URL that moves when their stack does, switching a dictionary off in
 * Shirabe leaves every word they have already hovered showing it until tomorrow.
 *
 * A cache key, never a sharing key. Nothing may be shared on the strength of it
 * (the lookup route bypasses the shared cache for every linked reader), so the
 * failure the sharing version risked cannot happen here.
 *
 * The KEY is deliberately not here. This is the half that is safe for a browser
 * to hold; the credential itself is only ever handed to our own server, through
 * `getShirabeCredential`.
 *
 * Guarded, because a session read failing is the whole site failing. A reader
 * being signed out is a far worse outcome than a word card falling back to the
 * default dictionaries, so anything that goes wrong here answers "not linked".
 */
/**
 * Which languages a linked reader reads definitions in, and in what order, taken
 * from their Shirabe stack.
 *
 * A stack entry is `slug:language`, so a reader who put `jmdict:es` above
 * `jmdict:en` has already said Spanish first -- over there, in the place that
 * owns their dictionaries. Without this the word card asked the Nadeshiko
 * setting instead, and the two answered differently for the same reader.
 *
 * Only the languages the card can print. A personal monolingual sits in the
 * stack as `:ja`, which is not a gloss language choice and is shown regardless
 * (`selectDefinitions`). An empty result means the stack said nothing useful, and
 * the card falls back to the reader's own setting.
 */
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
      select: { id: true, stackFingerprint: true, stack: true },
    });
    if (!connection) return null;

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

/**
 * Reports the new account to PostHog.
 *
 * Deliberately fires from here rather than from the browser. The browser already
 * reports `signup_completed`, and that event carries something this one never can
 * -- which feature gate the visitor hit before they signed up -- but it is only
 * as reliable as the reader's content blocker. This one fires once per row that
 * reaches the database, so the two answer different questions: how many, and why.
 *
 * Guarded the same way the welcome email is. Analytics must never be the reason a
 * sign-up fails.
 */
export function captureAccountCreatedAfterUserCreate(
  user: BetterAuthCreatedUser,
  captureFn: typeof captureAccountCreated = captureAccountCreated,
) {
  if (!user.id) {
    return;
  }

  // `createdAt` reaches us through the hook's index signature, so it is `unknown`
  // however true its shape is at runtime. Narrowed rather than asserted: if it is
  // ever neither, the capture falls back to the current time instead of throwing
  // inside a sign-up.
  const createdAt = user.createdAt;

  captureFn({
    userId: String(user.id),
    createdAt: createdAt instanceof Date || typeof createdAt === 'string' ? createdAt : undefined,
  });
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
            // First, and synchronous: it only enqueues, and putting it ahead of
            // the awaits means a slow mailer or a database hiccup below cannot
            // cost us the one record of this account that nothing in the browser
            // can suppress.
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
