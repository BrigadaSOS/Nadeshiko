import type { ListUserLabs, EnrollUserLab, UnenrollUserLab } from 'generated/routes/user';
import { assertUser } from '@app/middleware/authentication';
import { getExperimentsForUser, isUserEligibleForExperiment } from '@lib/experiments';
import { ExperimentEnrollment } from '@app/models/ExperimentEnrollment';
import { NotFoundError } from '@app/errors';

export const listUserLabs: ListUserLabs = async (_params, respond, req) => {
  const user = assertUser(req);
  const experiments = await getExperimentsForUser(user);

  const response = experiments.map(({ experiment, active }) => ({
    key: experiment.key,
    active,
    userControllable: !experiment.enforced,
    ...(experiment.enforced
      ? {}
      : {
          name: experiment.name,
          description: experiment.description,
        }),
  }));

  return respond.with200().body(response);
};

export const enrollUserLab: EnrollUserLab = async ({ params }, respond, req) => {
  const user = assertUser(req);

  if (!(await isUserEligibleForExperiment(user, params.key))) {
    throw new NotFoundError('Lab feature not found');
  }

  await ExperimentEnrollment.upsert({ userId: user.id, experimentKey: params.key }, ['userId', 'experimentKey']);

  return respond.with204();
};

export const unenrollUserLab: UnenrollUserLab = async ({ params }, respond, req) => {
  const user = assertUser(req);

  const result = await ExperimentEnrollment.delete({
    userId: user.id,
    experimentKey: params.key,
  });
  if (!result.affected) {
    throw new NotFoundError('Lab enrollment not found');
  }

  return respond.with204();
};
