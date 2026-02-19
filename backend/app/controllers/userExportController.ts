import type { ExportUserData } from 'generated/routes/user';
import { AuthCredentialsInvalidError } from '@app/errors';
import { exportAllUserData } from '@app/services/activityService';

export const exportUserData: ExportUserData = async (_params, respond, req) => {
  const user = req.user;
  if (!user) {
    throw new AuthCredentialsInvalidError('Invalid session user.');
  }

  const data = await exportAllUserData(user.id);
  return respond.with200().body(data);
};
