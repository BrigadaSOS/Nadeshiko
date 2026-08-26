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
import { APIError } from 'better-auth/api';
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
];

// A 14-minute per-user cooldown used to live here. It has been replaced by
// `signInAddressRateLimit` (five an hour, per address) for one reason: it
// returned WITHOUT SENDING AND WITHOUT SAYING SO, so a reader who did not
// receive the first mail asked again, got a "check your inbox" screen, and got
// nothing -- the exact failure the suppression branch in `sendMagicLink`
// explicitly refuses to introduce a few lines further down. It was also keyed on
// an existing `User.id`, so a brand-new address had no cooldown at all.

/**
 * Where the sign-in code waits between being minted and being posted.
 *
 * ONE EMAIL, NOT TWO, is the whole reason this exists. better-auth generates and
 * stores the code inside `sendVerificationOTP`, which is a callback whose job is
 * normally to send its own mail -- and a second message arriving beside the
 * magic link would be two things to read, two things to expire, and twice the
 * volume on a relay we are careful about. So that callback sends nothing and
 * leaves the code here, and `sendMagicLink` picks it up and puts both in one
 * message.
 *
 * The handoff is not racy despite looking it: `sendMagicLink` awaits the call
 * that triggers the stash before it reads, so the value is always present by
 * then. The short TTL is a leak guard, not a coordination window.
 */
const LOGIN_CODE_HANDOFF_CACHE = createCacheNamespace('loginCodeHandoff', 10_000);
const LOGIN_CODE_HANDOFF_MS = 60 * 1000;

/**
 * The live instance, assigned immediately after construction.
 *
 * `sendMagicLink` has to ask better-auth for a code, which means reaching the
 * very object it is being passed into. A module-level import of `auth` from here
 * would be a cycle; this is the same reference without one.
 */
/**
 * Typed as the one call it is used for rather than as the whole instance:
 * `typeof auth` is inferred from the options this very object is passed into, so
 * naming it here would be circular. A structural minimum also states plainly
 * what this reference is allowed to do.
 */
let authInstance: {
  api: { sendVerificationOTP: (args: { body: { email: string; type: 'sign-in' } }) => Promise<unknown> };
} | null = null;

/**
 * How long an impersonation lasts, and the reason it is a constant rather than a
 * number inside the admin plugin's options: the session update hook below has to
 * know it too, and the two drifting apart would silently lengthen or shorten
 * every impersonation.
 */
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

/**
 * PREFERENCES RIDE THE SESSION, and they have been here before -- e730331b4
 * ("Fetch preferences separately to avoid tying these to the cookie",
 * 2026-03-31) took them out six weeks after `cookieCache` was switched on. The
 * fear was that a reader's preferences would be pinned to the cached session
 * cookie for its 5-minute life, so a saved change would not show until it
 * expired. Neither half of that holds now:
 *
 * - better-auth cannot pin them. `customSession` does not wrap the cached
 *   value; it registers its OWN `/get-session`, calls the base handler, and runs
 *   this function on whatever comes back (better-auth 1.6.27,
 *   plugins/custom-session/index.mjs). The cookie cache lives inside the base
 *   handler, so a cache HIT still reaches here -- and every field below is read
 *   from `findUserById`, never from the spread. The cookie decides whether
 *   Postgres is asked for the SESSION; it has never decided anything about role,
 *   shirabe, or these.
 * - The frontend already treated them as session data anyway. Preferences have
 *   shared the session's SSR cache entry since 24af28c65 (2026-08-05) and its
 *   `nd-prefs-version` invalidation since 37e7a654d (2026-08-14). Their
 *   staleness window was already the session's, to the millisecond.
 *
 * What it buys: `GET /v1/user/preferences` was the second of two STRICTLY
 * SEQUENTIAL backend calls in the SSR prologue (`app/plugins/identity-auth.ts`),
 * and nothing on a signed-in render started until both returned. Measured
 * 2026-08-23 in production, that prologue was ~94ms p50 of the signed-in
 * render gap; this deletes the second round trip from it. The row is already in
 * hand -- `defaultFindUserById` is a `findOne` with no `select`, so `preferences`
 * came back with `role` all along and was thrown away.
 *
 * `{}` rather than undefined when the row is missing: every preference falls
 * back to a default, and a reader is better served by an empty object than by a
 * key the client has to guard.
 */
export async function enrichSessionUser(user: BetterAuthSessionUser, findUserById: FindUserById = defaultFindUserById) {
  const dbUser = await findUserById(Number(user.id));
  return {
    ...user,
    role: dbUser?.role ?? UserRoleType.USER,
    preferences: dbUser?.preferences ?? {},
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
      select: { id: true, stackFingerprint: true, stack: true, disconnectedAt: true, syncedAt: true },
    });
    if (!connection) return null;

    // The reader is here. If their stack copy has gone a week without being
    // re-read, re-read it -- and by doing so renew the OAuth token when it is
    // due, which is what keeps an active reader's grant from reaching Shirabe's
    // 90-day idle horizon even when every lookup hits cache.
    // Fire-and-forget: the session read is not waiting on Shirabe for anything,
    // and `refreshIfStale` dedupes and never throws. Before the disconnected
    // check on purpose -- a successful read is what clears that mark, and a
    // reader whose key was refused a while ago may since have undone whatever
    // caused it.
    if (stackIsStale(connection.syncedAt)) void refreshIfStale(userId);

    /**
     * A refused key is not a link, however much the row looks like one.
     *
     * `linked` is what gates the whole reader path: the lookup route reads it to
     * decide whether to fetch the stored credential at all, so leaving it true
     * for a dead link means every single word costs a doomed credential fetch
     * and a doomed Shirabe call before falling back to the defaults it was
     * always going to fall back to.
     *
     * The row still exists and the settings page still reads it -- that is where
     * the reader is told what happened and offered the repair. This is only
     * about not spending requests on a key we already know Shirabe refuses.
     */
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
        // `input: false` so the value can only ever come from the header the
        // create hook reads. Without it better-auth accepts the field from the
        // sign-up request body, and a self-declared country is worse than none:
        // it looks like a measurement and is not one.
        signupCountry: { type: 'string', fieldName: 'signup_country', required: false, input: false },
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
      additionalFields: {
        // Alongside `ip_address` and `user_agent`, which better-auth already
        // fills from the same request. `input: false` for the same reason as
        // `signupCountry` above -- it is read from the edge, never accepted
        // from a caller.
        country: { type: 'string', fieldName: 'country', required: false, input: false },
      },
      // NINETY DAYS, RAISED FROM THIRTY, and the thirty was never a security
      // judgement -- it was better-auth's default, left alone.
      //
      // `updateAge` below refreshes a session on use, so this bounds nobody who
      // visits within a quarter of a year. The only people it ever reached were
      // readers already away a month, who came back to a sign-out they had not
      // asked for -- the population a win-back email is aimed at, arriving to a
      // login wall in the one message whose entire purpose is that they came
      // back. Of the fifty accounts in the first dormant send, every one was
      // signed out by construction, because the sweep selected on exactly this
      // expiry.
      //
      // SAFE TO CHANGE ONLY BECAUSE DORMANCY NO LONGER READS IT. Until
      // `DORMANT_AFTER_DAYS` existed, "dormant" meant "this value has elapsed",
      // so raising it here would have quietly turned a thirty-day win-back into
      // a ninety-day one. Check that constant before touching this again.
      expiresIn: 90 * 24 * 60 * 60,
      updateAge: 7 * 24 * 60 * 60,
      // OFF DELIBERATELY, and it has to be off for the account page to work.
      //
      // better-auth's `freshSessionMiddleware` 403s (SESSION_NOT_FRESH) once a
      // session is older than `freshAge`, which defaults to 24h. Sessions here
      // live 90 days, so with the default every reader who logged in yesterday
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
      /**
       * The typed half of the emailed sign-in. See `@app/services/auth/loginCode`
       * for why six characters is enough and what the browser binding buys.
       *
       * `sendVerificationOTP` DELIBERATELY SENDS NOTHING. It is the hook where
       * better-auth hands over the code it has just hashed and stored, and the
       * only thing wanted here is the value -- the magic-link mail carries it.
       * Only `sign-in` is stashed: the other three types are flows we do not run
       * this way, and silently swallowing one of them later would be a message
       * that never arrives.
       */
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
        // Sixty an hour per client, matching shirabe. Loose ON PURPOSE: an IP is
        // not a person -- a school, an office and everyone behind CGNAT share
        // one -- and the tight `3 per 5 minutes` this replaced would lock a
        // classroom out at the fourth student. The per-person budget is
        // `signInAddressRateLimit`; this is only here to stop one machine
        // walking a list of addresses.
        //
        // Only meaningful because `advanced.ipAddress` below now lets better-auth
        // resolve a real client. Before that it could not, and every request
        // shared one bucket -- see the note there.
        rateLimit: { window: 60 * 60, max: 60 },
        sendMagicLink: async ({ email, url }) => {
          // REFUSE OUT LOUD, rather than letting `sendEmail` drop it silently.
          //
          // The suppression check in `sendEmail` protects our sending reputation
          // and would already stop this message, but it stops it invisibly: the
          // caller gets a success, the person gets a "check your inbox" screen,
          // and nothing ever arrives. Magic link is a sign-in path, so that is a
          // locked account with no error message -- which is the exact failure
          // this whole feature exists to end, and it would be perverse to
          // introduce it here.
          //
          // This does leak that an address is suppressed, which is a small
          // enumeration signal. It buys somebody who would otherwise be stuck
          // forever a reason to try their other address, and a suppressed
          // address is not evidence that an account exists -- most of what is on
          // that list never signed up.
          if (await isSuppressed(email)) {
            throw new APIError('BAD_REQUEST', {
              code: 'EMAIL_UNDELIVERABLE',
              message:
                'We cannot deliver email to that address: a previous message bounced or was reported as spam. Please use a different address.',
            });
          }

          // AFTER the suppression and cooldown checks above, both of which can
          // return without sending: minting a code for a mail we then decide not
          // to send would leave a live row nobody was ever told about.
          await sendMagicLinkEmailFn(email, url, await mintLoginCode(email));
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
        /**
         * Where this device is signing in from.
         *
         * Set here rather than left to the adapter because better-auth fills
         * `ip_address` and `user_agent` itself but knows nothing about
         * `CF-IPCountry`. Reading it off the same context it uses for those two
         * keeps the three columns describing one request instead of drifting
         * apart.
         *
         * Never throws and never blocks: a missing header returns null and the
         * session is written without a country, which is the state every
         * existing row is already in.
         */
        create: {
          before: async (data, context) => {
            const country = countryFromAuthContext(context);
            if (!country) return;

            return { data: { ...data, country } };
          },
          /**
           * A sign-in is the most precise last-seen there is, so it is recorded
           * here as well as on refresh.
           *
           * `after`, not `before`: this writes to a different table, and
           * better-auth runs after-hooks once the session is committed. A
           * failure updating a convenience column must not be able to roll back
           * or fail the sign-in that provoked it.
           */
          after: async (session, context) => {
            if (!shouldRecordLastSeen(session)) return;

            await recordLastSeen(resolveUserId(session) as number, countryFromAuthContext(context));
          },
        },
        /**
         * Impersonation sessions, and ONLY impersonation sessions.
         *
         * better-auth issues one of these with its own short duration and then
         * refreshes it on the same global schedule as everything else: a
         * 30-minute session is inside the refresh window from the moment it is
         * created, so the refresh writes `now + expiresIn` and the most
         * privileged session on the site -- one admin acting as another account
         * -- becomes a thirty-day one. This holds it to the duration the admin
         * plugin was configured with.
         *
         * In an ordinary browser the refresh never gets this far: better-auth
         * sets a `dont_remember` cookie alongside an impersonation and skips
         * refreshing entirely while it rides along. This covers the case where
         * that cookie is not carried -- a token replayed on its own -- which is
         * exactly the case worth being careful about.
         *
         * ADMINS ARE DELIBERATELY NOT SPECIAL HERE. There used to be a create
         * hook giving them eight hours instead of thirty days, and it never
         * enforced anything: the first refresh, roughly five minutes after
         * signing in, rewrote it to the full thirty. Rather than start enforcing
         * a cap the site had never actually run under, the decision was to drop
         * it -- admins now hold the same sliding thirty-day session as every
         * other reader, which is what they have held in practice all along. If a
         * shorter admin lifetime is ever wanted, it needs BOTH a create hook and
         * a branch here; one without the other is the bug this replaced.
         *
         * Returning `false` to skip the write is not an option in this hook: the
         * caller reads a null update as a dead session and deletes the cookie,
         * which would sign the reader out on their next request.
         */
        update: {
          before: async (data, context) => {
            const active = context?.context.session;
            if (!active?.session.impersonatedBy) return;

            const createdAt = new Date(active.session.createdAt).getTime();
            if (!Number.isFinite(createdAt)) return;

            return { data: { ...data, expiresAt: new Date(createdAt + IMPERSONATION_SESSION_MAX_AGE_MS) } };
          },
          /**
           * The refresh is what keeps last-seen current for somebody who never
           * signs in again because they never sign out. It fires at most once
           * per `updateAge` -- seven days -- so this is a weekly write per
           * active reader, not a per-request one.
           *
           * Impersonation is filtered by `shouldRecordLastSeen`, which is the
           * same rule the create hook uses and the reason it is a named
           * predicate rather than an inline check in both places.
           */
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
            // `emailVerified` is left to the flow that created the account:
            // the magic-link plugin sets it because the link itself proves the
            // address, and OAuth carries the provider's own claim. Forcing it
            // true here would also vouch for email/password sign-ups, which
            // prove nothing (that path is disabled today — see DISABLED_PATHS).
            //
            // `signupCountry` is written here and nowhere else. This hook is the
            // only moment the request that opened the account is still in reach:
            // the `verification` row that carried the magic link is deleted on
            // consumption, so a minute later there is nothing left to ask. Null
            // when the header is absent, and the column stays null forever after
            // -- where the reader signs in from later is `session.country`.
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
      /**
       * WITHOUT THIS, BETTER-AUTH RATE LIMITS THE WHOLE SITE AS ONE CLIENT.
       *
       * Its limiter is on by default in production, and it resolves the caller
       * from `x-forwarded-for` -- but with no `trustedProxies` configured it
       * only trusts a header carrying a SINGLE value, and refuses a chain as
       * spoofable. Behind Cloudflare, the Kamal proxy and the Nitro proxy that
       * header is always a chain, so the address came back null and every
       * request keyed to one shared `no-trusted-ip` bucket per path. The
       * magic-link rule above was therefore a cap on the entire application
       * rather than on a client: it has never fired, because the volume has
       * never been high enough, and the first thing that would have tripped it
       * is a release announcement bringing people back to sign in at once.
       *
       * `cf-connecting-ip` is a single value that Cloudflare sets and the proxy
       * forwards, which is the same header `resolveClientIp` prefers for our own
       * limiters. `x-forwarded-for` stays as the fallback for a request that
       * did not come through Cloudflare.
       */
      ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'],
      },
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

/**
 * Ask better-auth for a sign-in code, and get the plaintext back.
 *
 * Returns null rather than throwing on any failure, and that direction is
 * deliberate: the code is the SECOND way into an account and the link in the
 * same message is the first. A code that could not be minted costs the reader a
 * convenience; an exception here would cost them the sign-in email entirely.
 */
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
// `buildAuthOptions` returns the widened `BetterAuthOptions`, so better-auth
// cannot infer the plugin endpoints back out of it and `auth.api` is typed with
// the base routes only. The cast asserts the one endpoint this file calls, which
// the `emailOTP` plugin above is what puts there.
authInstance = auth as unknown as typeof authInstance;
