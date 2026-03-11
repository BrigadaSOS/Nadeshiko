import type { ListUserLabs, EnrollUserLab, UnenrollUserLab } from 'generated/routes/user';
import { assertUser } from '@app/middleware/authentication';
import { getLabsForUser, isLabVisible } from '@lib/labs';
import { LabEnrollment } from '@app/models/LabEnrollment';
import { invalidateUserCache } from '@app/middleware/authCacheStore';
import { NotFoundError } from '@app/errors';

export const listUserLabs: ListUserLabs = async (_params, respond, req) => {
  const user = assertUser(req);

  const response = getLabsForUser(user).map(({ lab, active }) => ({
    key: lab.key,
    name: lab.name,
    description: lab.description,
    active,
  }));

  return respond.with200().body(response);
};

export const enrollUserLab: EnrollUserLab = async ({ params }, respond, req) => {
  const user = assertUser(req);

  if (!isLabVisible(user, params.key)) {
    throw new NotFoundError('Lab feature not found');
  }

  await LabEnrollment.upsert({ userId: user.id, labKey: params.key }, ['userId', 'labKey']);
  invalidateUserCache(user.id);

  return respond.with204();
};

export const unenrollUserLab: UnenrollUserLab = async ({ params }, respond, req) => {
  const user = assertUser(req);

  const result = await LabEnrollment.delete({
    userId: user.id,
    labKey: params.key,
  });
  if (!result.affected) {
    throw new NotFoundError('Lab enrollment not found');
  }

  invalidateUserCache(user.id);

  return respond.with204();
};
