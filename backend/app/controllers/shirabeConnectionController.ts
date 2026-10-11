import type {
  GetShirabeConnection,
  StartShirabeLink,
  CompleteShirabeLink,
  UnlinkShirabe,
  GetShirabeCredential,
  ResyncShirabeStack,
  ReportShirabeRefusal,
} from 'generated/routes/user';
import { assertUser } from '@app/middleware/authentication';
import { AccessDeniedError, NotFoundError } from '@app/errors';
import { isInternalProxyRequest } from '@lib/internalProxy';
import {
  completeLink,
  findConnection,
  getReaderAccessToken,
  markDisconnected,
  missingScopes,
  refreshStack,
  resyncStack,
  startLink,
  unlink,
} from '@app/services/shirabe/connection';

/** Linking is session-only: API keys must not attach a third-party account on someone’s behalf. */

export const getShirabeConnection: GetShirabeConnection = async (_params, respond, req) => {
  const user = assertUser(req);
  const connection = await findConnection(user.id);
  // Always re-read this settings page; `refreshStack` falls back to the stored list on outage, while lookup keeps its
  // cache to avoid a round trip per word.
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

/** Never expose linked credentials to the browser: require the internal proxy as well as the server-only route
 * marker, and fail closed without its secret. */
export const getShirabeCredential: GetShirabeCredential = async (_params, respond, req) => {
  const user = assertUser(req);

  if (!isInternalProxyRequest(req)) {
    throw new AccessDeniedError('This credential is only readable by the Nadeshiko frontend server');
  }

  // Return a valid, renewed reader token when linked; if none exists, preserve the unlinked 404 fallback rather than
  // handing out the service key.
  const token = await getReaderAccessToken(user.id);
  if (!token) throw new NotFoundError('No Shirabe account is linked');

  return respond.with200().body({ token });
};

/** Keep resync behind the internal gate: a browser-supplied fingerprint must not trigger an arbitrary Shirabe
 * refresh; all outcomes return 204. */
export const resyncShirabeStack: ResyncShirabeStack = async ({ body }, respond, req) => {
  const user = assertUser(req);

  if (!isInternalProxyRequest(req)) {
    throw new AccessDeniedError('This route is only callable by the Nadeshiko frontend server');
  }

  await resyncStack(user.id, body.stackFingerprint);

  return respond.with204();
};

/** Use Shirabe’s error distinction: 401 disconnects a dead link, while missing scopes refreshes permissions instead
 * of unlinking the reader. */
export const reportShirabeRefusal: ReportShirabeRefusal = async ({ body }, respond, req) => {
  const user = assertUser(req);

  if (!isInternalProxyRequest(req)) {
    throw new AccessDeniedError('This route is only callable by the Nadeshiko frontend server');
  }

  const connection = await findConnection(user.id);
  if (!connection) return respond.with204();

  if (body.status === 401) {
    await markDisconnected(connection);
  } else if (body.status === 403) {
    // A missing permission is not a dead link; refresh stored scopes so the existing “Update permissions” path can
    // respond.
    await refreshStack(connection);
  }

  return respond.with204();
};
