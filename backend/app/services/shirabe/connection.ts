import { createHash, randomBytes } from 'node:crypto';
import { config } from '@config/config';
import { logger } from '@config/log';
import { ShirabeConnection } from '@app/models/ShirabeConnection';
import { InvalidRequestError, ValidationFailedError } from '@app/errors';
import { currentKeyId, decryptSecret, encryptSecret, keyIdOf } from '@lib/secretBox';
import { Cache, createCacheNamespace } from '@lib/cache';

/**
 * Linking a reader's Shirabe account to their Nadeshiko one: OAuth 2.0
 * authorization code with PKCE, ending in a token PAIR we store and renew.
 *
 * We are a CONFIDENTIAL client over there (`OauthClient`, admin-registered): the
 * consent screen names us rather than printing a label we sent about ourselves,
 * the address a code may be redirected to is pinned, and we present a client
 * secret on every call to the token endpoint. What the exchange yields is an
 * access token that lives an hour and a refresh token that rotates on every
 * renewal, both under a grant the reader can revoke from their Shirabe access
 * list. The access token is what a lookup sends; the refresh token is what
 * `getReaderAccessToken` trades for the next one when the hour is nearly up.
 *
 * Scopes: READ_DICTIONARY and READ_ACCOUNT. The consent screen is the moment a
 * reader decides, and a permission with no feature behind it is the one that
 * makes them say no -- so we do not ask for the SRS scopes until something here
 * writes to their study data.
 */

const AUTHORIZE_PATH = '/oauth/authorize';
const TOKEN_PATH = '/api/v1/oauth/token';
const REVOKE_PATH = '/api/v1/oauth/revoke';
const ME_PATH = '/api/v1/me';
/**
 * What this deployment needs from a linked account, and the single place that
 * decides it.
 *
 * Asked for at consent time AND compared against what a stored link actually
 * carries (`missingScopes`), which is what makes adding one a change here rather
 * than a migration.
 *
 * BOTH scopes are load-bearing, and it took a wrong version of this list to see
 * why. `READ_ACCOUNT` reads the reader's dictionary stack off `GET /api/v1/me`.
 * `READ_DICTIONARY` is what lets the key ASK: every endpoint on Shirabe's API
 * defaults to requiring it (their `Api::BaseController.required_scope`), and
 * `POST /api/v1/words/identify` does not override that. A link carrying
 * READ_ACCOUNT alone therefore reads the stack it is never allowed to use.
 *
 * That failure is silent, which is the reason for this paragraph. `identify`
 * answers 403, our lookup route treats 403 as "this reader's key was refused"
 * and retries on the service key, and the reader gets the DEFAULT dictionaries
 * with no error anywhere: linking succeeds, reports success, and changes
 * nothing. Anything added here in future wants the same question asked of it,
 * namely which call fails and how loudly, before it is assumed to be enough.
 *
 * Deliberately NOT the SRS scopes, since nothing here touches study data.
 *
 * Adding one is TWO changes, in two repos. This list widens, and the client is
 * re-registered on Shirabe with a matching ceiling:
 *
 *   bin/rails oauth_clients:register CLIENT_ID=nadeshiko ... SCOPES=...
 *
 * Miss the second and `OauthClient#grantable` narrows the request silently --
 * the reader approves a screen that never mentions the new permission and ends
 * up with a key that cannot do the thing. `completeLink` refuses that outcome
 * loudly rather than storing it; see `assertGranted`.
 */
export const REQUIRED_SCOPES = ['READ_DICTIONARY', 'READ_ACCOUNT'] as const;

/** How long a started link has to finish. Long enough to sign in over there
 *  (including a magic link in another tab), short enough that an abandoned one
 *  is not still redeemable tomorrow. */
const FLOW_TTL_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 10_000;

/**
 * Who we say we are on every call made with a reader's key.
 *
 * Shirabe records the agent that redeemed the code on the key it mints, and
 * shows it on the reader's access list beside the client name. Node's default
 * would print "node" there, which tells the reader nothing about which of their
 * connected apps this row is.
 */
const USER_AGENT = 'Nadeshiko (+https://nadeshiko.co)';

/**
 * Renew the access token this long before it actually expires, so a lookup
 * never goes out on a token that dies in flight. The reader's key is fetched on
 * a cache miss and used moments later, but the clocks are two machines' and the
 * network is real, so a minute of headroom is cheap insurance.
 */
const ACCESS_TOKEN_RENEW_AHEAD_MS = 60 * 1000;

/**
 * How old a stack copy may get before a reader's PRESENCE refreshes it.
 *
 * Two things ride on this one number. The stack copy is what lookups are cached
 * by, and it is otherwise only re-read when the reader opens their settings or a
 * lookup notices drift -- so a reader who reads daily but rarely hovers a new
 * word could carry a week-old stack. And the grant itself: Shirabe ends an OAuth
 * grant whose refresh token has not been renewed in 90 days, and renewal only
 * happens when we need a new access token, which is when a lookup misses cache.
 * A reader here every day whose lookups all hit their browser cache would renew
 * nothing and, in 90 days, lose a link they are relying on. This refresh reads
 * `/me` through `refreshStack`, which renews the token when it is due -- so it
 * re-copies the stack AND keeps an active reader's grant from ever reaching the
 * idle horizon.
 *
 * A week is far enough under 90 days that a reader who shows up even monthly is
 * never dropped, and far enough over a day that a daily reader costs Shirabe one
 * extra request a week rather than one a visit.
 */
export const STACK_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** Readers whose stale stack a refresh is already in flight or recently done
 *  for. Session reads arrive in bursts (a page is several of them), and without
 *  this every one of the burst would start its own Shirabe round trip. */
const REFRESH_INFLIGHT_CACHE = createCacheNamespace('shirabeStackRefresh', 10_000);
const REFRESH_INFLIGHT_MS = 60 * 60 * 1000;

interface PendingFlow {
  userId: number;
  verifier: string;
  expiresAt: number;
}

/**
 * The `state` is the whole pending flow, encrypted, rather than a key into
 * something we stored.
 *
 * The obvious implementation keeps `{state -> verifier}` in the process cache,
 * and it is wrong here for a reason that only shows up in production: the
 * request that STARTS the flow and the request that finishes it are two separate
 * HTTP calls minutes apart, and nothing routes them to the same process. The
 * reader would link successfully or not depending on which container answered,
 * which is the kind of bug that never reproduces locally.
 *
 * So nothing is stored. The state carries the verifier and who it belongs to,
 * sealed with our own key (AES-GCM, so it cannot be forged or edited), and the
 * callback opens it. Shirabe sees an opaque string; the browser carries a blob
 * only we can read.
 */
/** Its own key, derived from the same root as the stored tokens but unrelated to
 *  it: a `state` handed around in a browser URL should not share key material
 *  with credentials sitting in the database. */
const STATE_CONTEXT = { purpose: 'shirabe.oauth-state' } as const;

/** Bound to the reader, so a ciphertext lifted into another reader's row fails
 *  to open rather than handing them someone else's Shirabe token. A purpose per
 *  half, so an access ciphertext cannot be opened as a refresh one even in the
 *  same row. */
const accessTokenContext = (userId: number) => ({ purpose: 'shirabe.access-token', aad: String(userId) });
const refreshTokenContext = (userId: number) => ({ purpose: 'shirabe.refresh-token', aad: String(userId) });

function sealFlow(flow: PendingFlow): string {
  return encryptSecret(JSON.stringify(flow), connectionSecret(), STATE_CONTEXT);
}

function openFlow(state: string): PendingFlow {
  let flow: PendingFlow;
  try {
    flow = JSON.parse(decryptSecret(state, connectionSecrets(), STATE_CONTEXT)) as PendingFlow;
  } catch {
    // Deliberately the same message for a forged state, a corrupt one, and one
    // sealed under a rotated secret: a caller cannot use the difference to
    // learn which of those it produced.
    throw new InvalidRequestError('This link request is not valid. Start again from your settings.');
  }

  if (!flow?.verifier || !flow.userId || flow.expiresAt < Date.now()) {
    throw new InvalidRequestError('This link request has expired. Start again from your settings.');
  }

  return flow;
}

/**
 * Every key a stored value might have been sealed with: the current one first,
 * then the one being rotated out if there is one. Writing always uses
 * `connectionSecret`; only reading looks past it.
 */
function connectionSecrets(): string[] {
  return [config.SHIRABE_CONNECTION_SECRET, config.SHIRABE_CONNECTION_SECRET_PREVIOUS].filter(Boolean);
}

function connectionSecret(): string {
  const secret = config.SHIRABE_CONNECTION_SECRET;
  if (!secret) {
    throw new ValidationFailedError({
      connection: 'Linking a Shirabe account is not configured on this server.',
    });
  }
  return secret;
}

/** PKCE S256: the challenge is what Shirabe stores, the verifier is what proves
 *  the redemption came from whoever started the flow. */
function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Step one: where to send the reader, and the sealed state that will bring them
 * back. Nothing is written until they approve.
 */
export function startLink(userId: number): { authorizeUrl: string; state: string } {
  const redirectUri = config.SHIRABE_OAUTH_REDIRECT_URI;
  if (!redirectUri) {
    throw new ValidationFailedError({
      connection: 'Linking a Shirabe account is not configured on this server.',
    });
  }

  const verifier = randomBytes(48).toString('base64url');
  const state = sealFlow({ userId, verifier, expiresAt: Date.now() + FLOW_TTL_MS });

  const url = new URL(AUTHORIZE_PATH, config.SHIRABE_API_BASE);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.SHIRABE_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: REQUIRED_SCOPES.join(' '),
    state,
    code_challenge: challengeFor(verifier),
    code_challenge_method: 'S256',
  }).toString();

  return { authorizeUrl: url.toString(), state };
}

/** The token endpoint's answer (RFC 6749 §5.1). One shape for the first
 *  exchange and for every renewal. */
interface TokenResponse {
  access_token: string;
  refresh_token: string;
  /** Seconds the access token lives. */
  expires_in: number;
  /** Space-separated granted scopes. */
  scope?: string;
}

interface MeResponse {
  user?: { name?: string; displayName?: string };
  /** What the token we just used actually carries, which is not always what we
   *  asked for: Shirabe narrows a request to what the client is registered for. */
  credential?: { scopes?: string[] };
  preferences?: {
    dictionaries?: string[];
    stackFingerprint?: string;
    stackIsPrivate?: boolean;
    /** Slug => display name, for the stack. Only Shirabe can name a reader's own
     *  uploads, which are filed under content hashes. */
    dictionaryNames?: Record<string, string>;
  };
}

/**
 * Step two: swap the one-time code for a key, then immediately ask Shirabe who
 * we just linked and what their stack is. Both, before anything is stored:
 * a row holding a token we have never successfully used is a link that looks
 * fine on the settings page and fails on the first lookup.
 */
export async function completeLink(userId: number, code: string, state: string): Promise<ShirabeConnection> {
  const flow = openFlow(state);

  // The state proves the flow was started HERE; this proves it was started by
  // the person finishing it. Without it, an attacker who completes their own
  // authorization at Shirabe could hand the resulting callback URL to a
  // logged-in victim and attach their account to the victim's -- after which
  // every word the victim looks up is shaped by, and visible to, the attacker's
  // dictionary stack.
  if (flow.userId !== userId) {
    throw new InvalidRequestError('This link request belongs to a different account.');
  }

  const token = await exchangeCode(bodyForCode(code, flow.verifier));

  // From here on a grant EXISTS on the reader's Shirabe access list, approved
  // for us, and only we hold its tokens. Anything that stops the link being
  // stored has to hand that grant back, or every failed attempt leaves another
  // live "Nadeshiko" row over there that nothing on this side will ever use.
  try {
    // The cheap check first: the token response already says what the grant
    // carries, and a token missing READ_ACCOUNT cannot even read `/me` -- so
    // asking `/me` first would turn the one misconfiguration `assertGranted`
    // exists to name into a generic 403 that names nothing.
    assertGranted(token, {});

    // Any refusal here is the same outcome for the reader -- the link did not
    // happen, start again -- so the status `fetchProfile` now carries is only
    // logged. It exists for `refreshStack`, where a 401 means something a 500
    // does not.
    const profile = await fetchProfile(token.access_token).catch((error: unknown) => {
      if (error instanceof ShirabeRefusedError) {
        throw new InvalidRequestError('Shirabe would not complete the link. Start again from your settings.');
      }
      throw error;
    });
    // Again, on what `/me` reports: it is the authority on the token that made
    // the call, and the token response is only what Shirabe meant to grant.
    assertGranted(token, profile);

    return await saveConnection(userId, token, profile);
  } catch (error) {
    await revokeGrant(token.refresh_token, userId);
    throw error;
  }
}

/**
 * Refuse a key that came back missing something we asked for.
 *
 * This is not a reader problem, it is ours: Shirabe narrows a request to what
 * the client is REGISTERED for, so a scope added here without being added to the
 * registration is granted silently short. Storing it would leave the reader
 * looking at a connected account whose settings page keeps telling them to
 * approve permissions they just approved -- a loop with no way out, and nothing
 * in it saying the fault is on our side.
 *
 * Loud instead: the operator sees which scope is missing, and the reader is told
 * plainly that the feature is unavailable rather than that they did it wrong.
 */
function assertGranted(token: TokenResponse, profile: MeResponse): void {
  const granted = new Set(grantedScopes(token, profile));
  const missing = REQUIRED_SCOPES.filter((scope) => !granted.has(scope));
  if (missing.length === 0) return;

  logger.error(
    { missing, granted: [...granted], clientId: config.SHIRABE_OAUTH_CLIENT_ID },
    'Shirabe granted fewer scopes than we asked for. Re-register the client with a matching ceiling: ' +
      'bin/rails oauth_clients:register CLIENT_ID=<id> SCOPES=<...>',
  );
  throw new InvalidRequestError(
    'Shirabe could not grant everything this connection needs. Nothing was linked; this is being looked into.',
  );
}

/** The token-endpoint body for the first exchange: the code, its PKCE verifier,
 *  and our client identity. */
function bodyForCode(code: string, verifier: string): Record<string, string> {
  return {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: config.SHIRABE_OAUTH_REDIRECT_URI,
    ...clientCredentials(),
  };
}

/** Who we are to the token endpoint. A confidential client, so the secret rides
 *  on every call: the exchange, the renewal, the revoke. */
function clientCredentials(): Record<string, string> {
  return {
    client_id: config.SHIRABE_OAUTH_CLIENT_ID,
    client_secret: config.SHIRABE_OAUTH_CLIENT_SECRET,
  };
}

/**
 * The grant is over, and no renewal can bring it back: the reader revoked it,
 * it idled out, or the refresh token was replayed and Shirabe killed the grant.
 * Distinct from a transient failure precisely because the caller reacts
 * differently -- this marks the link disconnected, a bad minute does not.
 */
export class ShirabeGrantOverError extends Error {
  constructor() {
    super('The Shirabe grant is no longer valid');
    this.name = 'ShirabeGrantOverError';
  }
}

/**
 * POST the token endpoint. `invalid_grant` from a refresh is the grant ending,
 * and is raised as `ShirabeGrantOverError`; every other non-ok is transient and
 * raised plainly, so a renewal in progress does not disconnect a reader over a
 * 500. The exchange path treats both the same (any failure means "start again")
 * and translates at its own call site.
 */
async function exchangeCode(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(new URL(TOKEN_PATH, config.SHIRABE_API_BASE), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    // The body carries Shirabe's own reason (an expired code, a redirect
    // mismatch, an `error`), worth logging and NOT worth showing: it is about
    // our two servers, and a reader can do nothing with it but try again.
    const detail = await response.text().catch(() => '');
    logger.warn({ status: response.status, detail }, 'Shirabe rejected a token request');
    if (body.grant_type === 'refresh_token' && isInvalidGrant(detail)) throw new ShirabeGrantOverError();
    throw new InvalidRequestError('Shirabe would not complete the link. Start again from your settings.');
  }

  const token = (await response.json()) as TokenResponse;
  if (!token?.access_token || !token?.refresh_token) {
    throw new InvalidRequestError('Shirabe returned no tokens for this link.');
  }

  return token;
}

/** Shirabe answers a dead refresh token with `error: "invalid_grant"` (RFC 6749
 *  §5.2). That is the one refusal that means the link is over rather than that
 *  Shirabe is briefly unwell. */
function isInvalidGrant(detail: string): boolean {
  try {
    return (JSON.parse(detail) as { error?: string }).error === 'invalid_grant';
  } catch {
    return false;
  }
}

/**
 * A refusal from Shirabe, with the status still attached.
 *
 * `fetchProfile` used to collapse every non-ok response into one
 * `InvalidRequestError`, which read fine at the only call site it had -- the
 * link flow, where any failure means "start again" -- and erased the one thing
 * `refreshStack` needs to tell a dead link from a bad minute. Shirabe is precise
 * about this and we were throwing the precision away: 401 is `API_KEY_INVALID`
 * (invalid, expired, or revoked), 403 is `INSUFFICIENT_SCOPE`, and everything
 * else is not an answer about the key at all.
 */
export class ShirabeRefusedError extends Error {
  constructor(readonly status: number) {
    super(`Shirabe refused the request with ${status}`);
    this.name = 'ShirabeRefusedError';
  }
}

async function fetchProfile(apiKey: string): Promise<MeResponse> {
  const response = await fetch(new URL(ME_PATH, config.SHIRABE_API_BASE), {
    headers: { authorization: `Bearer ${apiKey}`, 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    logger.warn({ status: response.status }, 'Shirabe would not answer /me');
    throw new ShirabeRefusedError(response.status);
  }

  return (await response.json()) as MeResponse;
}

async function saveConnection(userId: number, token: TokenResponse, profile: MeResponse): Promise<ShirabeConnection> {
  // Linking again REPLACES the link rather than adding a second one: a reader
  // with two stacks gives a lookup no way to say which one it meant.
  const connection = (await ShirabeConnection.findOne({ where: { userId } })) ?? ShirabeConnection.create({ userId });

  // The grant we are about to stop using, its refresh token read BEFORE it is
  // overwritten and revoked only AFTER the new pair is stored -- see below.
  const replaced = connection.refreshTokenCiphertext ? readRefreshTokenIfPossible(connection) : null;

  applyTokens(connection, token);
  connection.scopes = grantedScopes(token, profile);
  connection.shirabeName = profile.user?.displayName || profile.user?.name || null;
  // Whatever ended the last link is over: this grant was approved seconds ago
  // and has already answered `/me`. Cleared here rather than left to the next
  // refresh so the settings page the reader lands back on is right immediately.
  connection.disconnectedAt = null;
  applyProfile(connection, profile);

  const stored = await connection.save();

  // Revoked rather than forgotten, and this is not the same call as `unlink`:
  // there, the reader asked us to let go of a grant that stays theirs; here, WE
  // are replacing one we will never use again. Leaving it would put a live grant
  // on their Shirabe access list that nothing on this side can ever reach -- and
  // re-consent, which is how a scope upgrade works, goes through here every time.
  //
  // Only once the new one is on disk. Revoking first looked equally reasonable
  // and was not: a write that failed after the revoke left the reader with a
  // row pointing at a dead grant and no new one, a broken link they did nothing
  // to cause. Best effort from here, since the link the reader asked for already
  // exists.
  if (replaced) await revokeGrant(replaced, userId);

  return stored;
}

/** Seal both tokens and stamp when the access one runs out. The single place
 *  the pair is written, so the exchange and every renewal store it the same. */
function applyTokens(connection: ShirabeConnection, token: TokenResponse): void {
  const userId = connection.userId;
  connection.accessTokenCiphertext = encryptSecret(token.access_token, connectionSecret(), accessTokenContext(userId));
  connection.refreshTokenCiphertext = encryptSecret(
    token.refresh_token,
    connectionSecret(),
    refreshTokenContext(userId),
  );
  connection.accessTokenExpiresAt = new Date(Date.now() + token.expires_in * 1000);
}

/**
 * What the grant really carries. `/api/v1/me` is the authority -- it reports the
 * scopes of the token that made the call -- and the token response's `scope`
 * string is the fallback when `/me` was not read (a renewal).
 */
function grantedScopes(token: TokenResponse, profile: MeResponse): string[] {
  return profile.credential?.scopes ?? token.scope?.split(' ').filter(Boolean) ?? [...REQUIRED_SCOPES];
}

/** What this deployment needs that a link does not carry. Empty means good. */
export function missingScopes(connection: ShirabeConnection): string[] {
  const granted = new Set(connection.scopes ?? []);
  return REQUIRED_SCOPES.filter((scope) => !granted.has(scope));
}

function applyProfile(connection: ShirabeConnection, profile: MeResponse): void {
  if (profile.credential?.scopes) connection.scopes = profile.credential.scopes;
  connection.stack = profile.preferences?.dictionaries ?? [];
  connection.stackNames = profile.preferences?.dictionaryNames ?? {};
  connection.stackFingerprint = profile.preferences?.stackFingerprint ?? null;
  connection.stackIsPrivate = profile.preferences?.stackIsPrivate ?? false;
  connection.syncedAt = new Date();
}

export async function findConnection(userId: number): Promise<ShirabeConnection | null> {
  return await ShirabeConnection.findOne({ where: { userId } });
}

/** The stored access token, in the clear. The lookup path is its only caller,
 *  and only through `getReaderAccessToken`, which renews it first if it is due. */
export function readAccessToken(connection: ShirabeConnection): string {
  return decryptSecret(connection.accessTokenCiphertext, connectionSecrets(), accessTokenContext(connection.userId));
}

/** The stored refresh token, in the clear. For renewal and for revocation. */
export function readRefreshToken(connection: ShirabeConnection): string {
  return decryptSecret(connection.refreshTokenCiphertext, connectionSecrets(), refreshTokenContext(connection.userId));
}

/**
 * The stored refresh token, or null when it cannot be opened -- for the callers
 * whose job is to LET GO of the grant.
 *
 * `readRefreshToken` throws when a ciphertext will not open: sealed under a
 * secret that is no longer configured, or corrupt. For `unlink` and for a
 * re-link that was the wrong answer -- the reader could neither remove the dead
 * link nor make a new one, and both attempts answered 500 for something only an
 * operator could have caused. A token we cannot read is a grant we cannot
 * revoke, and that is a log line, not a reason to keep the reader stuck.
 */
function readRefreshTokenIfPossible(connection: ShirabeConnection): string | null {
  try {
    return readRefreshToken(connection);
  } catch (error) {
    logger.error(
      { err: error, userId: connection.userId },
      'A stored Shirabe refresh token cannot be read and so the grant cannot be revoked; the reader can revoke it at Shirabe',
    );
    return null;
  }
}

/** Due for renewal: expired, or close enough that a lookup made with it might
 *  arrive after it dies. */
function accessTokenIsDue(connection: ShirabeConnection, now: number = Date.now()): boolean {
  return connection.accessTokenExpiresAt.getTime() <= now + ACCESS_TOKEN_RENEW_AHEAD_MS;
}

/**
 * A valid access token for this reader, renewing it first if it is due, or null
 * when there is nothing to hand out.
 *
 * The credential route calls this and nothing else. Null covers every reason a
 * lookup should quietly fall back to the service key: no link, a link Shirabe
 * has refused, or a renewal that found the grant over (which marks it so, so the
 * next lookup does not try again).
 */
export async function getReaderAccessToken(userId: number): Promise<string | null> {
  const connection = await findConnection(userId);
  if (!connection || connection.disconnectedAt) return null;
  if (!accessTokenIsDue(connection)) return readAccessToken(connection);

  try {
    const renewed = await renewAccessToken(userId);
    return renewed && readAccessToken(renewed);
  } catch (error) {
    if (error instanceof ShirabeGrantOverError) {
      await markDisconnected(connection);
      return null;
    }
    // A transient failure while renewing: the token we hold may already be past
    // its minute of headroom but is likely still good for the lookup about to
    // use it, and a bad minute at Shirabe must not read as a dead link.
    logger.warn({ err: error, userId }, 'Could not renew a Shirabe access token; using the one we hold');
    return readAccessToken(connection);
  }
}

/**
 * Trade the refresh token for the next pair, under a row lock.
 *
 * The lock is not decoration. A refresh token is single-use, and Shirabe
 * revokes the whole grant if the same one is presented twice: two Nadeshiko
 * workers renewing the same reader at once would each spend it, and the second
 * would kill the link. Serialised on the row, the second waiter re-reads inside
 * the lock, finds the token no longer due, and returns the pair the first one
 * just stored.
 *
 * Returns the refreshed connection, or null when the grant is not renewable at
 * all (no refresh token to read). Throws `ShirabeGrantOverError` when Shirabe
 * says the grant is over.
 */
async function renewAccessToken(userId: number): Promise<ShirabeConnection | null> {
  return ShirabeConnection.getRepository().manager.transaction(async (manager) => {
    const connection = await manager
      .createQueryBuilder(ShirabeConnection, 'connection')
      .setLock('pessimistic_write')
      .where('connection.userId = :userId', { userId })
      .getOne();
    if (!connection || connection.disconnectedAt) return null;

    // Another worker renewed while we waited for the lock. Its pair is on the
    // row we just read; nothing to do.
    if (!accessTokenIsDue(connection)) return connection;

    const refreshToken = readRefreshToken(connection);
    const token = await exchangeCode({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      ...clientCredentials(),
    });

    applyTokens(connection, token);
    if (token.scope) connection.scopes = token.scope.split(' ').filter(Boolean);
    return manager.save(connection);
  });
}

/**
 * Move a stored key onto the CURRENT encryption secret, if it is not there yet.
 *
 * The half of key rotation that reading across two keys does not give you.
 * `keyIdOf` says which secret sealed a row without opening it, so a rotation can
 * run as a background pass: point the new secret at `SHIRABE_CONNECTION_SECRET`,
 * leave the outgoing one in `_PREVIOUS`, and walk the table. Without this the
 * old key can never be retired, because nothing ever stops depending on it.
 *
 * Returns whether it wrote, so a pass can report what it did and be run again
 * without doing it twice. Rows already on the current key are the common case
 * after the first pass and cost one string comparison.
 *
 * v1 rows carry no key id at all and so always rewrite -- which is the intent:
 * they are also the rows with no purpose separation and no owner binding.
 */
export async function reencryptTokens(connection: ShirabeConnection): Promise<boolean> {
  const secret = connectionSecret();
  const current = currentKeyId(secret);
  if (keyIdOf(connection.accessTokenCiphertext) === current && keyIdOf(connection.refreshTokenCiphertext) === current) {
    return false;
  }

  // Through the readers, so the reading side keeps its one definition of which
  // keys apply and in what order -- a second copy here is how a rotation starts
  // silently skipping rows.
  const userId = connection.userId;
  connection.accessTokenCiphertext = encryptSecret(readAccessToken(connection), secret, accessTokenContext(userId));
  connection.refreshTokenCiphertext = encryptSecret(readRefreshToken(connection), secret, refreshTokenContext(userId));
  await connection.save();
  return true;
}

/**
 * Re-read the stack from Shirabe.
 *
 * A key that has been revoked at the other end answers 401, and that is the one
 * failure worth acting on rather than logging: the link is over, and leaving the
 * row unmarked would keep a dead credential on the settings page.
 *
 * Every other failure leaves what we have -- Shirabe being briefly unreachable
 * is not a reason to forget a reader's stack, and treating it as one would
 * disconnect everybody over a bad minute.
 *
 * A successful read also CLEARS the mark. The commonest way a link comes back is
 * not a re-consent but the reader undoing whatever ended it, and a row that
 * answers `/me` is by definition not refused.
 */
export async function refreshStack(connection: ShirabeConnection): Promise<ShirabeConnection> {
  try {
    // Through the same renew-if-due path a lookup uses, so a refresh never sends
    // a token about to expire and a renewal that finds the grant over is what
    // marks the link disconnected.
    const accessToken = await getReaderAccessToken(connection.userId);
    if (!accessToken) return (await findConnection(connection.userId)) ?? connection;

    const profile = await fetchProfile(accessToken);
    applyProfile(connection, profile);
    connection.disconnectedAt = null;
    return await connection.save();
  } catch (error) {
    // A 401 on a token we just renewed is the grant revoked out from under us
    // between the renewal and this call: the link is over.
    if (error instanceof ShirabeRefusedError && error.status === 401) {
      return await markDisconnected(connection);
    }
    logger.warn({ err: error, userId: connection.userId }, 'Could not refresh a Shirabe stack');
    return connection;
  }
}

/**
 * Record that Shirabe refused this key, if it has not already been recorded.
 *
 * Idempotent on purpose: the lookup path reports a refusal per word, so a reader
 * hovering their way down a page reports the same dead link a dozen times. Only
 * the first one is a write, and the timestamp keeps meaning "when the link
 * ended" rather than "when they last hovered something".
 */
export async function markDisconnected(connection: ShirabeConnection): Promise<ShirabeConnection> {
  if (connection.disconnectedAt) return connection;

  logger.info(
    { userId: connection.userId },
    'Shirabe would not renew a reader grant; the link is over until they redo it',
  );
  connection.disconnectedAt = new Date();
  return await connection.save();
}

/**
 * Whether a stack copy this old is due a presence-driven refresh. Exported so the
 * session path can decide from the columns it already reads, without loading
 * the row or knowing the number.
 */
export function stackIsStale(syncedAt: Date | null | undefined, now: number = Date.now()): boolean {
  return !syncedAt || syncedAt.getTime() < now - STACK_STALE_MS;
}

/**
 * The reader is here; make sure their link is too.
 *
 * Called from the session read, which is the one place that sees every reader
 * on every visit -- so it is a check on the row the session already loaded and
 * a round trip only when `stackIsStale` says so, once per `REFRESH_INFLIGHT_MS`
 * per reader however many session reads a page costs. The common case is one
 * date comparison and no request.
 *
 * What it buys is described on `STACK_STALE_MS`: a fresh stack copy for a
 * reader who never opens their settings, and a renewal often enough that an
 * active reader's grant never reaches Shirabe's 90-day idle horizon even if all
 * their lookups hit cache. There is deliberately no timer over all linked
 * accounts; a reader who is not here has nothing to keep fresh, and if they stay
 * away long enough for the grant to idle out, the reconnect card is the honest
 * answer.
 *
 * Never throws and never awaited by its caller: it is a session read's side
 * errand, and a Shirabe outage must not slow a page or sign anybody out.
 */
export async function refreshIfStale(userId: number): Promise<void> {
  const inflightKey = String(userId);
  if (Cache.get<true>(REFRESH_INFLIGHT_CACHE, inflightKey)) return;
  Cache.set(REFRESH_INFLIGHT_CACHE, inflightKey, true, REFRESH_INFLIGHT_MS);

  try {
    const connection = await findConnection(userId);
    if (!connection || !stackIsStale(connection.syncedAt)) return;

    logger.info({ userId }, 'A linked reader is here with a stale Shirabe stack; refreshing it');
    await refreshStack(connection);
  } catch (error) {
    logger.warn({ err: error, userId }, 'Could not refresh a stale Shirabe stack');
  }
}

/**
 * Reconcile the stored stack against a fingerprint a lookup just observed.
 *
 * Shirabe echoes the caller's current `stackFingerprint` on every `identify`, so
 * a word lookup already carries the answer to "has this reader changed anything
 * since we copied it?" -- for free, on a call that was happening anyway. This is
 * what makes a stack change visible in one hover rather than in a day: the
 * fingerprint is what the reader's cached lookups are keyed by, and this is what
 * moves it.
 *
 * The two outcomes are deliberately different amounts of work:
 *
 *   drift     re-read the stack, which is a round trip and worth it: something
 *             really did change and the settings page owes the reader the truth.
 *   agreement stamp `syncedAt` and stop. Nothing changed, and we have just
 *             confirmed it first-hand, so there is nothing to ask Shirabe.
 *
 * The lookup route only calls this on drift, deliberately: a word card is one
 * HTTP request per word, so reporting agreement too would be a write per hover
 * to record that nothing happened. The agreement branch is here for the race
 * that produces -- two lookups noticing the same change at once, the second
 * arriving after the first has already fixed it -- and it must stay cheap for
 * exactly that reason.
 *
 * There is no timer behind this and deliberately so. A periodic sweep would ask
 * Shirabe about every linked account forever, whether or not anybody was
 * reading, to catch the one reader who changed their stack and then hovered only
 * words their browser already held -- and that reader is fixed by the first
 * uncached word they meet, or by opening their own connections page.
 *
 * Never throws. It is called without being awaited, from a request whose real
 * job is already done.
 */
export async function resyncStack(userId: number, observed: string): Promise<void> {
  try {
    const connection = await findConnection(userId);
    if (!connection || !observed) return;

    if (connection.stackFingerprint === observed) {
      connection.syncedAt = new Date();
      await connection.save();
      return;
    }

    logger.info({ userId }, 'A Shirabe stack changed; re-reading it');
    await refreshStack(connection);
  } catch (error) {
    logger.warn({ err: error, userId }, 'Could not reconcile a Shirabe stack fingerprint');
  }
}

/**
 * Forget the link, and tell Shirabe to cut the key off.
 *
 * Both halves, because either on its own leaves the reader worse off than they
 * think they are: forgetting it here alone leaves a live key on their Shirabe
 * access list that nothing here can ever revoke again, and it is OUR unlink
 * button that made them believe otherwise.
 *
 * The local row goes whatever Shirabe says. If their server is down, the reader
 * still gets what they asked for here, and the key they are left with is one
 * they can revoke themselves at /account/settings#access.
 */
export async function unlink(userId: number): Promise<boolean> {
  const connection = await findConnection(userId);
  if (!connection) return false;

  const refreshToken = readRefreshTokenIfPossible(connection);
  if (refreshToken) await revokeGrant(refreshToken, userId);

  await connection.remove();
  return true;
}

/**
 * Hand a grant back to Shirabe to cut off (RFC 7009), by its refresh token.
 * Never throws: every caller has already decided to stop using this grant, and
 * Shirabe being unreachable is not a reason to leave the reader holding a link
 * we no longer honour on our side.
 *
 * The reader can always finish the job themselves at /account/settings#access,
 * which is why a failure here is a log line rather than an error.
 */
async function revokeGrant(refreshToken: string, userId: number): Promise<void> {
  try {
    await fetch(new URL(REVOKE_PATH, config.SHIRABE_API_BASE), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
      body: JSON.stringify({ token: refreshToken, ...clientCredentials() }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn({ err: error, userId }, 'Could not revoke a Shirabe grant; dropping it on this side anyway');
  }
}
