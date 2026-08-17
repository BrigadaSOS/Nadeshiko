import { getRequestHeader } from 'h3';
import type { H3Event } from 'h3';
import { buildInternalBackendHeaders, internalBackendUrl } from '~~/server/utils/internalBackend';
import { SESSION_COOKIE, hasSessionCookie, ssrAuthFetch } from '~~/server/utils/ssrAuthCache';
import { logger } from '~~/server/utils/logger';

/**
 * Whose dictionaries a word lookup should answer from.
 *
 * Shirabe shapes a lookup by the dictionary stack of whoever's key made the
 * call. Ours is a service identity with no preferences, so unlinked readers get
 * the default dictionaries -- which is right, and is what almost every request
 * here is. A reader who has linked their Shirabe account gets THEIR stack, in
 * their order, which means the lookup has to be made with their key.
 *
 * Two things are needed at two different moments, and the split is what keeps
 * this cheap:
 *
 *   WHETHER they have a stack   before the request is made, because it decides
 *                               whether the shared cache may answer at all
 *   the TOKEN                   only when a call is actually made
 *
 * So the first rides the session (the backend folds it into `get-session`), which
 * is already read once per render and cached for a minute; and the token is
 * fetched separately, from a route only this server may call.
 */

/** Where the answer is parked for the rest of the request. The cache decision
 *  and the handler both ask, and without this that is two session reads. */
const CONTEXT_KEY = 'shirabeReaderStack';

/**
 * The request's own cookie header, kept where the handler can still reach it.
 *
 * `defineCachedEventHandler` does not hand the handler the request it arrived
 * on. It builds a fresh event and copies `context` but NOT the headers, which is
 * correct of it -- a cached response must not silently depend on a header nobody
 * declared -- and it means `getRequestHeader(event, 'cookie')` is empty inside
 * the handler however the reader is signed in.
 *
 * That is not a small detail here, it is the whole feature: `readerToken` needs
 * the session cookie to fetch the reader's Shirabe key, found none, returned
 * null at its own guard without a word in the log, and every lookup fell back to
 * the service key. A linked reader saw the default dictionaries forever.
 *
 * `shouldBypassCache` runs on the REAL event, before any of that, and the
 * context it writes does survive. So the cookie is stashed there on the way past
 * and read back out afterwards.
 */
const COOKIE_KEY = 'shirabeReaderCookie';

function stashCookie(event: H3Event): string {
  const cookie = getRequestHeader(event, 'cookie') || '';
  if (cookie) event.context[COOKIE_KEY] = cookie;
  return cookie;
}

/** The cookie header, from wherever it still exists on this event. */
function readerCookie(event: H3Event): string {
  return (event.context[COOKIE_KEY] as string | undefined) || getRequestHeader(event, 'cookie') || '';
}

interface SessionResponse {
  user?: {
    shirabe?: { linked?: boolean; stackFingerprint?: string | null } | null;
  } | null;
}

/** Whose dictionaries this request is answered from, and which stack of theirs. */
export interface ReaderStack {
  linked: boolean;
  /** The stack the backend last copied from Shirabe. Compared against what
   *  Shirabe reports on the lookup, so a reader who reconfigured their
   *  dictionaries is noticed on the first call rather than on the next sweep. */
  fingerprint: string | null;
}

const UNLINKED: ReaderStack = { linked: false, fingerprint: null };

/**
 * Whether this reader has a Shirabe stack of their own, resolved on the SERVER.
 *
 * Deliberately not read from anything the client sends: it decides whether a
 * response may be stored in a cache other readers are served from, and a client
 * that could choose that could file its own answers where everybody else reads.
 * (The fingerprint the BROWSER sends is a different thing entirely -- a cache
 * key on its own request, which nothing here trusts or reads.)
 *
 * Never throws: the backend being unreachable means we do not know, and the
 * honest answer to that is the default dictionaries rather than a failed word
 * card.
 */
export async function readerStack(event: H3Event): Promise<ReaderStack> {
  const cached = event.context[CONTEXT_KEY] as ReaderStack | undefined;
  if (cached !== undefined) return cached;

  const resolved = await resolveStack(event);
  event.context[CONTEXT_KEY] = resolved;
  return resolved;
}

/** The cache decision on its own, in the shape `defineCachedEventHandler` wants. */
export async function readerHasOwnStack(event: H3Event): Promise<boolean> {
  return (await readerStack(event)).linked;
}

async function resolveStack(event: H3Event): Promise<ReaderStack> {
  // Kept for the handler, which will not be able to see it: `COOKIE_KEY`.
  stashCookie(event);

  // No cookie, no session, and the answer is not in doubt. This is most of the
  // traffic -- every crawler, every share link, every signed-out reader -- and
  // it costs nothing.
  if (!hasSessionCookie(event)) return UNLINKED;

  try {
    const config = useRuntimeConfig();
    // Scoped, and that scope is load-bearing: this stores the raw get-session
    // body while `identity-auth` stores a `{session, preferences}` bundle under
    // the same session key. Sharing one slot meant whichever ran first won and
    // the other silently read a shape it did not recognise -- which, since the
    // render always runs first, meant this one always concluded "not linked".
    const session = await ssrAuthFetch(
      event,
      () =>
        $fetch<SessionResponse>(internalBackendUrl(config, '/v1/auth/get-session'), {
          headers: buildInternalBackendHeaders(config, { cookie: getRequestHeader(event, 'cookie') || '' }, event),
          timeout: 2000,
        }),
      'shirabe',
    );

    const shirabe = session?.user?.shirabe;
    if (!shirabe?.linked) return UNLINKED;

    return { linked: true, fingerprint: shirabe.stackFingerprint ?? null };
  } catch (error) {
    logger.warn({ err: error }, 'Could not resolve the reader Shirabe stack; answering with the default dictionaries');
    return UNLINKED;
  }
}

/**
 * Tell the backend which stack Shirabe just answered from.
 *
 * Fire and forget, and called without being awaited: the lookup this rides on
 * has already got its answer, and the only thing waiting on this is the reader's
 * NEXT request, which will read the updated fingerprint off their session. A
 * backend that cannot be reached costs one interval of the periodic refresh.
 */
export async function reportStackFingerprint(event: H3Event, fingerprint: string): Promise<void> {
  try {
    const config = useRuntimeConfig();
    await $fetch(internalBackendUrl(config, '/v1/user/connections/shirabe/resync'), {
      method: 'POST',
      // Same stash, same reason: this runs inside the cached handler too.
      headers: buildInternalBackendHeaders(config, { cookie: readerCookie(event) }, event),
      body: { stackFingerprint: fingerprint },
      timeout: 2000,
    });
  } catch (error) {
    logger.warn({ err: error }, 'Could not report a Shirabe stack fingerprint');
  }
}

/**
 * The reader's Shirabe key, or null when there is nothing to fetch.
 *
 * Called only on a cache miss, which is what keeps a route that mostly serves
 * cached bytes from making a backend round trip per request.
 *
 * The key never reaches the browser: it comes from a backend route that refuses
 * anything not carrying the internal-proxy secret, and it is used here and
 * dropped. Same reasoning as `nadeshikoApiKey` in backendProxy.ts.
 */
export async function readerToken(event: H3Event): Promise<string | null> {
  // From the stash, not from the request: inside a cached handler there are no
  // headers left to read. See `COOKIE_KEY`.
  const cookie = readerCookie(event);
  if (!cookie.includes(SESSION_COOKIE)) return null;

  try {
    const config = useRuntimeConfig();
    const credential = await $fetch<{ token?: string }>(
      internalBackendUrl(config, '/v1/user/connections/shirabe/credential'),
      {
        headers: buildInternalBackendHeaders(config, { cookie }, event),
        timeout: 2000,
      },
    );

    return credential?.token ?? null;
  } catch (error) {
    // Including the ordinary case: a reader who never linked anything answers
    // 404 here. Falling back to the service key is the right move for every
    // reason this can fail -- an unlinked reader, a revoked key, a backend
    // blip -- so none of them is worth more than a line in the log.
    logger.warn({ err: error }, 'No Shirabe credential for this reader; falling back to the service key');
    return null;
  }
}
