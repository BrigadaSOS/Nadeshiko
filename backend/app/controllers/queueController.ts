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
} from '@app/workers/queueAdmin';
import { NotFoundError } from '@app/errors';
import {
  toAdminQueueActionResultDTO,
  toAdminQueueDetailsDTO,
  toAdminQueueFailedJobsDTO,
  toAdminQueueStatsDTO,
} from '@app/controllers/mappers/queue.mapper';

export const listAdminQueueStats: ListAdminQueueStats = async (_1, respond) => {
  const stats = await getStuckJobs();

  return respond.with200().body(toAdminQueueStatsDTO(stats));
};

export const getAdminQueue: GetAdminQueue = async ({ params }, respond) => {
  const { queueName } = params;

  const details = await getQueueDetailsOrFail(queueName);

  return respond.with200().body(toAdminQueueDetailsDTO(details));
};

export const listAdminQueueFailed: ListAdminQueueFailed = async ({ params }, respond) => {
  const { queueName } = params;

  const failedJobs = await fetchFailedJobs(queueName);

  return respond.with200().body(toAdminQueueFailedJobsDTO(failedJobs));
};

export const retryAdminQueueFailed: RetryAdminQueueFailed = async ({ params }, respond) => {
  const { queueName } = params;

  const retriedCount = await retryFailedJobs(queueName);

  return respond.with200().body(toAdminQueueActionResultDTO('retry', queueName, retriedCount));
};

export const purgeAdminQueueFailed: PurgeAdminQueueFailed = async ({ params }, respond) => {
  const { queueName } = params;

  const purgedCount = await deleteFailedJobs(queueName);

  return respond.with200().body(toAdminQueueActionResultDTO('purge', queueName, purgedCount));
};

async function getQueueDetailsOrFail(queueName: string) {
  const details = await fetchQueueDetails(queueName);

  if (!details) {
    throw new NotFoundError(`Queue ${queueName} not found or could not be retrieved`);
  }

  return details;
}
