import type { ExportUserData } from 'generated/routes/user';
import { assertUser } from '@app/middleware/authentication';
import { User } from '@app/models/User';
import { UserActivity } from '@app/models/UserActivity';
import { Collection, Report } from '@app/models';
import { toUserExportDTO } from './mappers/userExport.mapper';

export const exportUserData: ExportUserData = async (_params, respond, req) => {
  const user = assertUser(req);

  const [fullUser, activity, collections, reports] = await Promise.all([
    User.findOneOrFail({ where: { id: user.id } }),
    UserActivity.find({ where: { userId: user.id }, order: { createdAt: 'DESC' } }),
    Collection.find({ where: { userId: user.id }, relations: { segmentItems: true } }),
    Report.find({ where: { userId: user.id }, order: { createdAt: 'DESC' } }),
  ]);

  return respond.with200().body(toUserExportDTO(fullUser, activity, collections, reports));
};
