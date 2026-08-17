import type {
  GetShirabeConnection,
  StartShirabeLink,
  CompleteShirabeLink,
  UnlinkShirabe,
  GetShirabeCredential,
  ResyncShirabeStack,
} from 'generated/routes/user';
import { assertUser } from '@app/middleware/authentication';
import { AccessDeniedError, NotFoundError } from '@app/errors';
import { isInternalProxyRequest } from '@lib/internalProxy';
import {
  completeLink,
  findConnection,
  missingScopes,
  readToken,
  refreshStack,
  resyncStack,
  startLink,
  unlink,
} from '@app/services/shirabe/connection';

/**
 * Linking a reader's own Shirabe account.
 *
 * Why it exists: Shirabe shapes a word lookup by the dictionary stack of
 * whoever's key made the call, and ours belongs to a machine with no
 * preferences. Linked, the popup answers from the dictionaries the reader
 * configured over there, in their order.
 *
 * Session-only, all of it. None of these routes is reachable with an API key:
 * they are about the person in front of the browser, and a key acting on
 * somebody's behalf must not be able to attach a third-party account to them.
 * The spec says so with `SessionCookie: []`, which is what generates
 * `requireSession()`.
 */

export const getShirabeConnection: GetShirabeConnection = async (_params, respond, req) => {
  const user = assertUser(req);
  const connection = await findConnection(user.id);
  // ALWAYS re-read, with no staleness window in front of it.
  //
  // This is the page whose entire job is to show what Shirabe currently says, to
  // a reader who is looking straight at it and may have changed it seconds ago
  // in another tab. A window made that a lie: come back from Shirabe inside the
  // interval and the page confidently printed the dictionaries you had just
  // switched off. Being slightly cheaper is not worth a settings page that
  // disagrees with the service it is describing.
  //
  // Affordable because of who is asking: one reader, one page view, one call.
  // The lookup path deliberately does NOT do this -- it would put a Shirabe
  // round trip in front of a cache that exists to avoid one, on every word.
  //
  // `refreshStack` returns what we already hold if Shirabe cannot be reached, so
  // an outage over there shows a stale list rather than an error.
  const current = connection ? await refreshStack(connection) : null;

  return respond.with200().body({ connection: current ? current.toJSON(missingScopes(current)) : null });
};

export const startShirabeLink: StartShirabeLink = async (_params, respond, req) => {
  const user = assertUser(req);

  return respond.with201().body(startLink(user.id));
};

export const completeShirabeLink: CompleteShirabeLink = async ({ body }, respond, req) => {
  const user = assertUser(req);
  const connection = await completeLink(user.id, body.code, body.state);

  // Empty by construction -- `completeLink` refuses a grant that falls short --
  // but computed rather than hardcoded, so the two cannot drift.
  return respond.with200().body({ connection: connection.toJSON(missingScopes(connection)) });
};

export const unlinkShirabe: UnlinkShirabe = async (_params, respond, req) => {
  const user = assertUser(req);

  if (!(await unlink(user.id))) throw new NotFoundError('No Shirabe account is linked');

  return respond.with204();
};

/**
 * The stored key, for our own frontend server and nothing else.
 *
 * A session is NOT enough here, including the reader's own, and that is the
 * whole point of the extra gate: everything else on this controller returns
 * things safe to render, while this one returns a live credential for another
 * service. Anything a browser can fetch is a thing an extension, a bookmarklet
 * or a stray script on the page can fetch too.
 *
 * `isInternalProxyRequest` is the same shared secret the rate limiter and the
 * traffic classifier already trust, set by the Nitro proxy on every request it
 * forwards. With no secret configured it answers false, so the fail-safe is that
 * this route is simply unavailable rather than open.
 */
export const getShirabeCredential: GetShirabeCredential = async (_params, respond, req) => {
  const user = assertUser(req);

  if (!isInternalProxyRequest(req)) {
    throw new AccessDeniedError('This credential is only readable by the Nadeshiko frontend server');
  }

  const connection = await findConnection(user.id);
  if (!connection) throw new NotFoundError('No Shirabe account is linked');

  return respond.with200().body({ token: readToken(connection) });
};

/**
 * "The stack these answers came out of is X" -- from our own lookup route,
 * carrying what Shirabe just told it.
 *
 * Behind the same internal gate as the credential above, for a different reason.
 * That one guards a secret; this one guards a FACT about our own state. A
 * fingerprint a browser could post is a browser deciding when our copy of the
 * reader's stack looks stale, which is a free Shirabe round trip per request for
 * anyone who wants one.
 *
 * 204 whatever happened, including for a reader with no link at all. The caller
 * is a lookup that has already answered; there is nothing it could do with a
 * failure but log it twice.
 */
export const resyncShirabeStack: ResyncShirabeStack = async ({ body }, respond, req) => {
  const user = assertUser(req);

  if (!isInternalProxyRequest(req)) {
    throw new AccessDeniedError('This route is only callable by the Nadeshiko frontend server');
  }

  await resyncStack(user.id, body.stackFingerprint);

  return respond.with204();
};
