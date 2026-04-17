import type { GetUserPreferences, UpdateUserPreferences } from 'generated/routes/user';
import { assertUser } from '@app/middleware/authentication';
import { User } from '@app/models/User';
import { deepMerge } from '@lib/utils/deepMerge';

export const getUserPreferences: GetUserPreferences = async (_params, respond, req) => {
  const user = assertUser(req);

  return respond.with200().body(user.preferences);
};


export const updateUserPreferences: UpdateUserPreferences = async ({ body }, respond, req) => {
  const user = assertUser(req);

  const existing = user.preferences as Record<string, unknown>;
  const updated = deepMerge(existing, body as Record<string, unknown>);

  await User.update({ id: user.id }, { preferences: updated });
  user.preferences = updated as typeof user.preferences;

  return respond.with200().body(updated);
};
