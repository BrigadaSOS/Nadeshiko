import type {
  ListAdminQueueStats,
  GetAdminQueue,
  RetryAdminQueueFailed,
  ListAdminQueueFailed,
  PurgeAdminQueueFailed,
} from 'generated/routes/admin';
import {
  getStuckJobs,
  fetchQueueDetails,
  retryFailedJobs,
  getFailedJobs as fetchFailedJobs,
  purgeFailedJobs as deleteFailedJobs,
} from '@app/workers/pgBoss';
import { NotFoundError } from '@app/errors';

export const listAdminQueueStats: ListAdminQueueStats = async (_1, respond) => {
  const stats = await getStuckJobs();
  return respond.with200().body(stats);
};

export const getAdminQueue: GetAdminQueue = async ({ params }, respond) => {
  const { queueName } = params;
  const details = await fetchQueueDetails(queueName);

  if (!details) {
    throw new NotFoundError(`Queue ${queueName} not found or could not be retrieved`);
  }

  return respond.with200().body(details);
};

export const listAdminQueueFailed: ListAdminQueueFailed = async ({ params }, respond) => {
  const { queueName } = params;
  const failedJobs = await fetchFailedJobs(queueName);

  const jobs = failedJobs.map((job) => ({
    ...job,
    createdOn: job.createdOn.toISOString(),
  }));

  return respond.with200().body(jobs);
};

export const purgeAdminQueueFailed: PurgeAdminQueueFailed = async ({ params }, respond) => {
  const { queueName } = params;
  const purgedCount = await deleteFailedJobs(queueName);

  return respond.with200().body({
    success: true,
    purgedCount,
    message: `Purged ${purgedCount} failed jobs from ${queueName}`,
  });
};

export const retryAdminQueueFailed: RetryAdminQueueFailed = async ({ params }, respond) => {
  const { queueName } = params;
  const retriedCount = await retryFailedJobs(queueName);

  return respond.with200().body({
    success: true,
    retriedCount,
    message: `Retried ${retriedCount} failed jobs from ${queueName}`,
  });
};
