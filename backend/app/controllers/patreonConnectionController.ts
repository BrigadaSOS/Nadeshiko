import type { CompletePatreonLink, GetPatreonConnection, StartPatreonLink, UnlinkPatreon } from 'generated/routes/user';
import { assertUser } from '@app/middleware/authentication';
import { NotFoundError } from '@app/errors';
import {
  completePatreonLink as complete,
  getPatreonConnection as find,
  startPatreonLink as start,
  unlinkPatreon as unlink,
} from '@app/services/patreon/connection';
import { config } from '@config/config';

export const getPatreonConnection: GetPatreonConnection = async (_params, respond, req) => {
  const user = assertUser(req);
  // This endpoint powers the explicit "Check again" action after somebody joins.
  // Always verify with Patreon so a newly active membership is not hidden behind
  // the normal service-level freshness window.
  const connection = await find(user.id, true);
  return respond.with200().body({ connection: connection?.toJSON() ?? null, patreonUrl: config.PATREON_CAMPAIGN_URL });
};

export const startPatreonLink: StartPatreonLink = async (_params, respond, req) => {
  const user = assertUser(req);
  return respond.with201().body(start(user.id));
};

export const completePatreonLink: CompletePatreonLink = async ({ body }, respond, req) => {
  const user = assertUser(req);
  const connection = await complete(user.id, body.code, body.state);
  return respond.with200().body({ connection: connection.toJSON() });
};

export const unlinkPatreon: UnlinkPatreon = async (_params, respond, req) => {
  const user = assertUser(req);
  if (!(await unlink(user.id))) throw new NotFoundError('No Patreon account is linked');
  return respond.with204();
};
