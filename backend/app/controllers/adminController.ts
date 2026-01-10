import type {
  ReindexElasticsearch,
  GetQueueStats,
  GetQueueDetails,
  RetryQueueJobs,
  GetFailedJobs,
  PurgeFailedJobs,
} from 'generated/routes/admin';
import type { t_ReindexResponse } from 'generated/models';
import { reindexSegments, ReindexMediaItem } from '@app/services/elasticsearchSync';
import {
  getStuckJobs,
  fetchQueueDetails,
  retryFailedJobs,
  getFailedJobs as fetchFailedJobs,
  purgeFailedJobs as deleteFailedJobs,
} from '@lib/queue/pgBoss';

export const reindexElasticsearch: ReindexElasticsearch = async ({ body }, respond) => {
  const media = body?.media?.map(
    (item: { mediaId: number; episodes?: number[] }) =>
      ({
        mediaId: item.mediaId,
        episodes: item.episodes,
      }) as ReindexMediaItem,
  );

  const result = await reindexSegments(media);

  const response: t_ReindexResponse = {
    success: result.success,
    message: result.message,
    stats: {
      totalSegments: result.stats.totalSegments,
      successfulIndexes: result.stats.successfulIndexes,
      failedIndexes: result.stats.failedIndexes,
      mediaProcessed: result.stats.mediaProcessed,
    },
    errors: result.errors,
  };

  return respond.with200().body(response);
};

/**
 * Get statistics for all ES sync queues.
 * Returns pending and failed job counts for each queue.
 */
export const getQueueStats: GetQueueStats = async (_1, respond) => {
  const stats = await getStuckJobs();
  return respond.with200().body(stats);
};

/**
 * Get detailed information about a specific queue.
 */
export const getQueueDetails: GetQueueDetails = async ({ params }, respond) => {
  const { queueName } = params;
  const details = await fetchQueueDetails(queueName);

  if (!details) {
    return respond.with404().body({
      code: 'NOT_FOUND',
      detail: `Queue ${queueName} not found or could not be retrieved`,
      status: 404,
      title: 'Not Found',
    });
  }

  return respond.with200().body(details);
};

/**
 * Get failed jobs from a specific queue.
 * Returns jobs that have exceeded their retry limit.
 */
export const getFailedJobs: GetFailedJobs = async ({ params }, respond) => {
  const { queueName } = params;
  const failedJobs = await fetchFailedJobs(queueName);

  // Convert Date to string for JSON response
  const jobs = failedJobs.map((job) => ({
    ...job,
    createdOn: job.createdOn.toISOString(),
  }));

  return respond.with200().body(jobs);
};

/**
 * Purge failed jobs from a specific queue.
 * Permanently deletes all failed jobs.
 */
export const purgeFailedJobs: PurgeFailedJobs = async ({ params }, respond) => {
  const { queueName } = params;
  const purgedCount = await deleteFailedJobs(queueName);

  return respond.with200().body({
    success: true,
    purgedCount,
    message: `Purged ${purgedCount} failed jobs from ${queueName}`,
  });
};

/**
 * Retry failed jobs from a specific queue.
 */
export const retryQueueJobs: RetryQueueJobs = async ({ params }, respond) => {
  const { queueName } = params;
  const retriedCount = await retryFailedJobs(queueName);

  return respond.with200().body({
    success: true,
    retriedCount,
    message: `Retried ${retriedCount} failed jobs from ${queueName}`,
  });
};
