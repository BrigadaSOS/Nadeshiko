import { createHash, randomBytes } from 'node:crypto';
import { config } from '@config/config';
import { logger } from '@config/log';
import { ShirabeConnection } from '@app/models/ShirabeConnection';
import { InvalidRequestError, ValidationFailedError } from '@app/errors';
import { currentKeyId, decryptSecret, encryptSecret, keyIdOf } from '@lib/secretBox';
import { Cache, createCacheNamespace } from '@lib/cache';

/** Use OAuth authorization-code PKCE as a registered confidential client with a secret; store the rotating pair and
 * honor `expires_in`. */

const AUTHORIZE_PATH = '/oauth/authorize';
const TOKEN_PATH = '/api/v1/oauth/token';
const REVOKE_PATH = '/api/v1/oauth/revoke';
const ME_PATH = '/api/v1/me';
/** Both `READ_ACCOUNT` and `READ_DICTIONARY` are required: one reads `/me`, the other permits lookup. Missing scopes
 * must fail linking, not silently fall back. */
export const REQUIRED_SCOPES = ['READ_DICTIONARY', 'READ_ACCOUNT'] as const;

/** Let OAuth state survive a second-tab sign-in, but not an abandoned flow. */
const FLOW_TTL_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 10_000;

/** Send a descriptive user agent so Shirabe's access list identifies Nadeshiko rather than Node. */
const USER_AGENT = 'Nadeshiko (+https://nadeshiko.co)';

/** Renew before expiry so network delay and clock differences cannot invalidate a token during lookup. */
const ACCESS_TOKEN_RENEW_AHEAD_MS = 60 * 1000;

/** Refresh a stack weekly on reader presence: it limits Shirabe traffic while renewing grants before the 90-day idle
 * horizon. */
export const STACK_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** Deduplicate stale-stack refreshes per reader; session reads arrive in bursts and must not start parallel Shirabe
 * requests. */
const REFRESH_INFLIGHT_CACHE = createCacheNamespace('shirabeStackRefresh', 10_000);
const REFRESH_INFLIGHT_MS = 60 * 60 * 1000;

interface PendingFlow {
  userId: number;
  verifier: string;
  expiresAt: number;
}

/** Seal the entire OAuth state, not a process-local lookup key, because start and callback may hit different
 * containers. */
/** Derive OAuth-state key material separately from stored-token keys; a browser URL must not share a key with
 * database credentials. */
const STATE_CONTEXT = { purpose: 'shirabe.oauth-state' } as const;

/** Bind ciphertext to the reader and give access/refresh tokens distinct purposes, so copied rows or cross-purpose
 * opens fail. */
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

/** Read with the current then previous encryption key during rotation; write only with the current key. */
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

/** Exchange and validate the grant, profile, and dictionary stack before storing it; a row must not look linked
 * before its first lookup works. */
export async function completeLink(userId: number, code: string, state: string): Promise<ShirabeConnection> {
  const flow = openFlow(state);

  // Require the callback user to match the sealed flow owner; otherwise an attacker could attach their dictionary grant
  // to a logged-in victim.
  if (flow.userId !== userId) {
    throw new InvalidRequestError('This link request belongs to a different account.');
  }

  const token = await exchangeCode(bodyForCode(code, flow.verifier));

  // Once Shirabe has granted access, revoke that grant if local storage fails; otherwise failed attempts leave live
  // unused grants behind.
  try {
    // Check token scopes before `/me`; a missing `READ_ACCOUNT` should produce the explicit configuration error, not a
    // generic 403.
    assertGranted(token, {});

    // Keep profile status for refresh handling: link setup treats any refusal as retryable setup failure, while refresh
    // distinguishes 401 from 500.
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

/** Reject a grant missing required scopes and report the mismatch; do not store a link that will repeatedly ask the
 * reader to re-consent. */
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

/** Represent revoked, idle, or replayed grants separately from transient failures; only the former marks the link
 * disconnected. */
export class ShirabeGrantOverError extends Error {
  constructor() {
    super('The Shirabe grant is no longer valid');
    this.name = 'ShirabeGrantOverError';
  }
}

/** Treat refresh `invalid_grant` as grant loss; other token-endpoint failures remain transient, while exchange
 * callers translate them locally. */
async function exchangeCode(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(new URL(TOKEN_PATH, config.SHIRABE_API_BASE), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    // Log the provider's token-endpoint detail for diagnosis, but show the reader only a retryable generic error.
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

/** `invalid_grant` is the RFC-defined dead-refresh-token response; other refusals may be transient and must not
 * disconnect the link. */
function isInvalidGrant(detail: string): boolean {
  try {
    return (JSON.parse(detail) as { error?: string }).error === 'invalid_grant';
  } catch {
    return false;
  }
}

/** Preserve provider status so 401/403 can mean invalid key/scope while other statuses remain non-credential
 * failures. */
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
  // Clear a prior disconnected mark immediately after a newly approved grant has answered `/me`.
  connection.disconnectedAt = null;
  applyProfile(connection, profile);

  const stored = await connection.save();

  // Store the replacement before revoking the old grant; revoking first could leave the reader with neither a live row
  // nor a new grant.
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

/** Use `/me` scopes as authority and token-response scopes only as the renewal fallback. */
function grantedScopes(token: TokenResponse, profile: MeResponse): string[] {
  return profile.credential?.scopes ?? token.scope?.split(' ').filter(Boolean) ?? [...REQUIRED_SCOPES];
}

/** What this deployment needs that a link does not carry. Empty means good. */
export function missingScopes(connection: ShirabeConnection): string[] {
  const granted = new Set(connection.scopes ?? []);
  return REQUIRED_SCOPES.filter((scope) => !granted.has(scope));
}

/** Patch only stack fields: a loaded entity may hold a spent refresh token after renewal, and saving it would
 * overwrite the fresh pair. */
function profilePatch(profile: MeResponse) {
  return {
    // Absent from the patch rather than defaulted: a `/me` that reports no
    // scopes is not a link that carries none.
    ...(profile.credential?.scopes ? { scopes: profile.credential.scopes } : {}),
    stack: profile.preferences?.dictionaries ?? [],
    stackNames: profile.preferences?.dictionaryNames ?? {},
    stackFingerprint: profile.preferences?.stackFingerprint ?? null,
    stackIsPrivate: profile.preferences?.stackIsPrivate ?? false,
    syncedAt: new Date(),
  };
}

/** The patch above, applied in place. For `saveConnection`, which is writing the
 *  whole row anyway because it is the row's first writer. */
function applyProfile(connection: ShirabeConnection, profile: MeResponse): void {
  Object.assign(connection, profilePatch(profile));
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

/** Unreadable refresh ciphertext returns null for unlink/relink cleanup; log the unrevokeable grant instead of
 * turning operator-caused damage into a 500. */
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

/** Missing or disconnected grants return null so lookup can use the service key; transient renewal failures do not
 * unlink the reader. */
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
    // On transient renewal failure, use the held token rather than treating a bad Shirabe minute as a dead grant.
    logger.warn({ err: error, userId }, 'Could not renew a Shirabe access token; using the one we hold');
    return readAccessToken(connection);
  }
}

/** Refresh under a row lock: Shirabe refresh tokens are single-use, so a waiter must re-read the pair after the
 * first worker commits. */
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

/** Re-encrypt only when the key id is not current; read through the shared key-rotation path so old v1 rows gain
 * owner/purpose binding. */
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

/** A `/me` 401 marks grant loss; other profile failures preserve the cached stack, and success clears the mark. */
export async function refreshStack(connection: ShirabeConnection): Promise<ShirabeConnection> {
  try {
    // Through the same renew-if-due path a lookup uses, so a refresh never sends
    // a token about to expire and a renewal that finds the grant over is what
    // marks the link disconnected.
    const accessToken = await getReaderAccessToken(connection.userId);
    if (!accessToken) return (await findConnection(connection.userId)) ?? connection;

    const profile = await fetchProfile(accessToken);

    // Update stack columns only; a concurrent token renewal must not be overwritten by saving this stale entity.
    const patch = { ...profilePatch(profile), disconnectedAt: null };
    await ShirabeConnection.update({ userId: connection.userId }, patch);

    // In memory too, since the caller renders what it was handed.
    Object.assign(connection, patch);
    return connection;
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

/** Record the first refusal only; repeated per-word lookups must not move the timestamp from “link ended” to “last
 * hover.” */
export async function markDisconnected(connection: ShirabeConnection): Promise<ShirabeConnection> {
  if (connection.disconnectedAt) return connection;

  logger.info(
    { userId: connection.userId },
    'Shirabe would not renew a reader grant; the link is over until they redo it',
  );
  connection.disconnectedAt = new Date();
  // Use a scoped update because refresh callers may hold a superseded token pair that must never be written back.
  await ShirabeConnection.update({ userId: connection.userId }, { disconnectedAt: connection.disconnectedAt });
  return connection;
}

/** Export the staleness predicate so session code can decide from columns it already reads, without loading the row. */
export function stackIsStale(syncedAt: Date | null | undefined, now: number = Date.now()): boolean {
  return !syncedAt || syncedAt.getTime() < now - STACK_STALE_MS;
}

/** Refresh on reader presence, deduplicated per reader, and never let the unawaited side task slow or fail the
 * session request. */
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

/** Resync only on observed fingerprint drift; the agreement path stays cheap so one write is not made per word
 * hover. */
export async function resyncStack(userId: number, observed: string): Promise<void> {
  try {
    const connection = await findConnection(userId);
    if (!connection || !observed) return;

    if (connection.stackFingerprint === observed) {
      connection.syncedAt = new Date();
      // Write only `syncedAt`; a concurrent lookup may be rotating credentials, so a whole-entity save would race it.
      await ShirabeConnection.update({ userId }, { syncedAt: connection.syncedAt });
      return;
    }

    logger.info({ userId }, 'A Shirabe stack changed; re-reading it');
    await refreshStack(connection);
  } catch (error) {
    logger.warn({ err: error, userId }, 'Could not reconcile a Shirabe stack fingerprint');
  }
}

/** Unlink locally and revoke remotely; if Shirabe is unavailable, still honor the local request and leave remote
 * cleanup to the reader. */
export async function unlink(userId: number): Promise<boolean> {
  const connection = await findConnection(userId);
  if (!connection) return false;

  const refreshToken = readRefreshTokenIfPossible(connection);
  if (refreshToken) await revokeGrant(refreshToken, userId);

  await connection.remove();
  return true;
}

/** Revoke by refresh token without throwing; the reader can finish cleanup in Shirabe settings if the provider is
 * unavailable. */
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
