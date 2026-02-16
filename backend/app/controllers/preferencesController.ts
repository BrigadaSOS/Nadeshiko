import type { UserPreferencesShow, UserPreferencesUpdate } from 'generated/routes/user';
import { User } from '@app/models/User';
import { AuthCredentialsInvalidError } from '@app/errors';

export const userPreferencesShow: UserPreferencesShow = async (_params, respond, req) => {
  const user = req.user;
  if (!user) {
    throw new AuthCredentialsInvalidError('Invalid session user.');
  }

  return respond.with200().body(user.preferences || {});
};

export const userPreferencesUpdate: UserPreferencesUpdate = async ({ body }, respond, req) => {
  const user = req.user;
  if (!user) {
    throw new AuthCredentialsInvalidError('Invalid session user.');
  }

  const existing = user.preferences || {};
  const updated = deepMerge(existing, body);

  await User.update({ id: user.id }, { preferences: updated });
  user.preferences = updated;

  return respond.with200().body(updated);
};

function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
