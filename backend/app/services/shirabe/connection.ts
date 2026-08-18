import { createHash, randomBytes } from 'node:crypto';
import { config } from '@config/config';
import { logger } from '@config/log';
import { ShirabeConnection } from '@app/models/ShirabeConnection';
import { InvalidRequestError, ValidationFailedError } from '@app/errors';
import { decryptSecret, encryptSecret } from '@lib/secretBox';

/**
 * Linking a reader's Shirabe account to their Nadeshiko one: OAuth 2.0
 * authorization code with PKCE, ending in a scoped Shirabe API key we store.
 *
 * We are a registered client over there (`OauthClient`, admin-registered), which
 * is what lets Shirabe's consent screen name us rather than print a label we
 * sent about ourselves, and what pins the address a code may be redirected to.
 *
 * Scopes: READ_DICTIONARY and READ_ACCOUNT. The consent screen is the moment a
 * reader decides, and a permission with no feature behind it is the one that
 * makes them say no -- so we do not ask for the SRS scopes until something here
 * writes to their study data.
 */

const AUTHORIZE_PATH = '/oauth/authorize';
const TOKEN_PATH = '/api/v1/oauth/token';
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
 *  to open rather than handing them someone else's Shirabe key. */
const tokenContext = (userId: number) => ({ purpose: 'shirabe.token', aad: String(userId) });

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

interface TokenResponse {
  apiKey: string;
  scopes?: string[];
}

interface MeResponse {
  user?: { name?: string; displayName?: string };
  /** What the key we just used actually carries, which is not always what we
   *  asked for: Shirabe narrows a request to what the client is registered for. */
  key?: { scopes?: string[] };
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

  const token = await exchangeCode(code, flow.verifier);
  const profile = await fetchProfile(token.apiKey);
  assertGranted(token, profile);

  return await saveConnection(userId, token, profile);
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

async function exchangeCode(code: string, verifier: string): Promise<TokenResponse> {
  const response = await fetch(new URL(TOKEN_PATH, config.SHIRABE_API_BASE), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: config.SHIRABE_OAUTH_REDIRECT_URI,
      client_id: config.SHIRABE_OAUTH_CLIENT_ID,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    // The body carries Shirabe's own reason (an expired code, a redirect
    // mismatch), which is worth logging and NOT worth showing: it is about our
    // two servers, and a reader can do nothing with it but try again.
    const detail = await response.text().catch(() => '');
    logger.warn({ status: response.status, detail }, 'Shirabe rejected the authorization code');
    throw new InvalidRequestError('Shirabe would not complete the link. Start again from your settings.');
  }

  const token = (await response.json()) as TokenResponse;
  if (!token?.apiKey) throw new InvalidRequestError('Shirabe returned no key for this link.');

  return token;
}

async function fetchProfile(apiKey: string): Promise<MeResponse> {
  const response = await fetch(new URL(ME_PATH, config.SHIRABE_API_BASE), {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    logger.warn({ status: response.status }, 'Shirabe would not answer /me for a freshly minted key');
    throw new InvalidRequestError('Shirabe would not complete the link. Start again from your settings.');
  }

  return (await response.json()) as MeResponse;
}

async function saveConnection(userId: number, token: TokenResponse, profile: MeResponse): Promise<ShirabeConnection> {
  // Linking again REPLACES the link rather than adding a second one: a reader
  // with two stacks gives a lookup no way to say which one it meant.
  const connection = (await ShirabeConnection.findOne({ where: { userId } })) ?? ShirabeConnection.create({ userId });

  // The key we are about to stop using. Revoked rather than forgotten, and this
  // is not the same call as `unlink`: there, the reader asked us to let go of a
  // credential that stays theirs; here, WE are replacing one we minted and will
  // never use again. Leaving it would put a live key on their Shirabe access
  // list that nothing on this side can ever reach -- and re-consent, which is
  // how a scope upgrade works, goes through here every time.
  //
  // Best effort, and deliberately after the new key is in hand: a reader whose
  // old key cannot be reached still gets the link they asked for.
  if (connection.tokenCiphertext) await revokeKey(readToken(connection), userId);

  connection.tokenCiphertext = encryptSecret(token.apiKey, connectionSecret(), tokenContext(userId));
  connection.tokenPrefix = token.apiKey.slice(0, 12);
  connection.scopes = grantedScopes(token, profile);
  connection.shirabeName = profile.user?.displayName || profile.user?.name || null;
  applyProfile(connection, profile);

  return await connection.save();
}

/**
 * What the key really carries. `/api/v1/me` is the authority -- it reports the
 * scopes of the key that made the call -- and the token response is the fallback
 * for a Shirabe old enough not to send it.
 */
function grantedScopes(token: TokenResponse, profile: MeResponse): string[] {
  return profile.key?.scopes ?? token.scopes ?? [...REQUIRED_SCOPES];
}

/** What this deployment needs that a link does not carry. Empty means good. */
export function missingScopes(connection: ShirabeConnection): string[] {
  const granted = new Set(connection.scopes ?? []);
  return REQUIRED_SCOPES.filter((scope) => !granted.has(scope));
}

function applyProfile(connection: ShirabeConnection, profile: MeResponse): void {
  if (profile.key?.scopes) connection.scopes = profile.key.scopes;
  connection.stack = profile.preferences?.dictionaries ?? [];
  connection.stackNames = profile.preferences?.dictionaryNames ?? {};
  connection.stackFingerprint = profile.preferences?.stackFingerprint ?? null;
  connection.stackIsPrivate = profile.preferences?.stackIsPrivate ?? false;
  connection.syncedAt = new Date();
}

export async function findConnection(userId: number): Promise<ShirabeConnection | null> {
  return await ShirabeConnection.findOne({ where: { userId } });
}

/** The stored key, in the clear. Only two callers have any business with this:
 *  the lookup path, and `unlink`, which hands it back to Shirabe to revoke. */
export function readToken(connection: ShirabeConnection): string {
  return decryptSecret(connection.tokenCiphertext, connectionSecrets(), tokenContext(connection.userId));
}

/**
 * Re-read the stack from Shirabe.
 *
 * A key that has been revoked at the other end answers 401, and that is the one
 * failure worth acting on rather than logging: the link is over, and leaving the
 * row would keep a dead credential on the settings page. Every other failure
 * leaves what we have -- Shirabe being briefly unreachable is not a reason to
 * forget a reader's stack.
 */
export async function refreshStack(connection: ShirabeConnection): Promise<ShirabeConnection> {
  try {
    const profile = await fetchProfile(readToken(connection));
    applyProfile(connection, profile);
    return await connection.save();
  } catch (error) {
    logger.warn({ err: error, userId: connection.userId }, 'Could not refresh a Shirabe stack');
    return connection;
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

  await revokeKey(readToken(connection), userId);

  await connection.remove();
  return true;
}

/**
 * Hand a key back to Shirabe to cut off. Never throws: every caller has already
 * decided to stop using this key, and Shirabe being unreachable is not a reason
 * to leave the reader holding a link we no longer honour on our side.
 *
 * The reader can always finish the job themselves at /account/settings#access,
 * which is why a failure here is a log line rather than an error.
 */
async function revokeKey(token: string, userId: number): Promise<void> {
  try {
    await fetch(new URL('/api/v1/me/key', config.SHIRABE_API_BASE), {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn({ err: error, userId }, 'Could not revoke a Shirabe key; dropping it on this side anyway');
  }
}
