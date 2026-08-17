import { getRequestHeader } from 'h3';
import type { H3Event } from 'h3';
import { buildInternalBackendHeaders, internalBackendUrl } from '~~/server/utils/internalBackend';
import { hasSessionCookie, ssrAuthFetch } from '~~/server/utils/ssrAuthCache';
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
const CONTEXT_KEY = 'shirabeReaderHasOwnStack';

interface SessionResponse {
  user?: {
    shirabe?: { linked?: boolean } | null;
  } | null;
}

/**
 * Whether this reader has a Shirabe stack of their own, resolved on the SERVER.
 *
 * Deliberately not read from anything the client sends: it decides whether a
 * response may be stored in a cache other readers are served from, and a client
 * that could choose that could file its own answers where everybody else reads.
 *
 * Never throws: the backend being unreachable means we do not know, and the
 * honest answer to that is the default dictionaries rather than a failed word
 * card.
 */
export async function readerHasOwnStack(event: H3Event): Promise<boolean> {
  const cached = event.context[CONTEXT_KEY] as boolean | undefined;
  if (cached !== undefined) return cached;

  const resolved = await resolveHasOwnStack(event);
  event.context[CONTEXT_KEY] = resolved;
  return resolved;
}

async function resolveHasOwnStack(event: H3Event): Promise<boolean> {
  // No cookie, no session, and the answer is not in doubt. This is most of the
  // traffic -- every crawler, every share link, every signed-out reader -- and
  // it costs nothing.
  if (!hasSessionCookie(event)) return false;

  try {
    const config = useRuntimeConfig();
    const session = await ssrAuthFetch(event, () =>
      $fetch<SessionResponse>(internalBackendUrl(config, '/v1/auth/get-session'), {
        headers: buildInternalBackendHeaders(config, { cookie: getRequestHeader(event, 'cookie') || '' }, event),
        timeout: 2000,
      }),
    );

    return Boolean(session?.user?.shirabe?.linked);
  } catch (error) {
    logger.warn({ err: error }, 'Could not resolve the reader Shirabe stack; answering with the default dictionaries');
    return false;
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
  if (!hasSessionCookie(event)) return null;

  try {
    const config = useRuntimeConfig();
    const credential = await $fetch<{ token?: string }>(
      internalBackendUrl(config, '/v1/user/connections/shirabe/credential'),
      {
        headers: buildInternalBackendHeaders(config, { cookie: getRequestHeader(event, 'cookie') || '' }, event),
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
