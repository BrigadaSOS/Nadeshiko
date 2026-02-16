import type {
  AdminReindexCreate,
  AdminQueueStatsIndex,
  AdminQueueShow,
  AdminQueueRetryCreate,
  AdminQueueFailedIndex,
  AdminQueueFailedDestroy,
  AdminMorphemeBackfillCreate,
} from 'generated/routes/admin';
import { reindexSegments, ReindexMediaItem } from '@app/services/elasticsearchSync';
import {
  getStuckJobs,
  fetchQueueDetails,
  retryFailedJobs,
  getFailedJobs as fetchFailedJobs,
  purgeFailedJobs as deleteFailedJobs,
} from '@app/workers/pgBoss';
import { Cache } from '@lib/cache';
import { SEARCH_STATS_CACHE } from '@app/services/elasticsearch';
import { NotFoundError } from '@app/errors';
import { logger } from '@config/log';

export const adminReindexCreate: AdminReindexCreate = async ({ body }, respond) => {
  const media = body?.media?.map(
    (item: { mediaId: number; episodes?: number[] }) =>
      ({
        mediaId: item.mediaId,
        episodes: item.episodes,
      }) as ReindexMediaItem,
  );

  const result = await reindexSegments(media);
  Cache.invalidate(SEARCH_STATS_CACHE);

  return respond.with200().body(result);
};

export const adminQueueStatsIndex: AdminQueueStatsIndex = async (_1, respond) => {
  const stats = await getStuckJobs();
  return respond.with200().body(stats);
};

export const adminQueueShow: AdminQueueShow = async ({ params }, respond) => {
  const { queueName } = params;
  const details = await fetchQueueDetails(queueName);

  if (!details) {
    throw new NotFoundError(`Queue ${queueName} not found or could not be retrieved`);
  }

  return respond.with200().body(details);
};

export const adminQueueFailedIndex: AdminQueueFailedIndex = async ({ params }, respond) => {
  const { queueName } = params;
  const failedJobs = await fetchFailedJobs(queueName);

  // Convert Date to string for JSON response
  const jobs = failedJobs.map((job) => ({
    ...job,
    createdOn: job.createdOn.toISOString(),
  }));

  return respond.with200().body(jobs);
};

export const adminQueueFailedDestroy: AdminQueueFailedDestroy = async ({ params }, respond) => {
  const { queueName } = params;
  const purgedCount = await deleteFailedJobs(queueName);

  return respond.with200().body({
    success: true,
    purgedCount,
    message: `Purged ${purgedCount} failed jobs from ${queueName}`,
  });
};

export const adminQueueRetryCreate: AdminQueueRetryCreate = async ({ params }, respond) => {
  const { queueName } = params;
  const retriedCount = await retryFailedJobs(queueName);

  return respond.with200().body({
    success: true,
    retriedCount,
    message: `Retried ${retriedCount} failed jobs from ${queueName}`,
  });
};

export const adminMorphemeBackfillCreate: AdminMorphemeBackfillCreate = async (_1, respond) => {
  // TEMPORARILY DISABLED - lindera.js dependency removed
  const errorMessage = 'Morpheme analysis temporarily disabled - lindera.js dependency removed';
  logger.warn(errorMessage);
  return respond.with200().body({
    success: false,
    message: errorMessage,
    stats: { totalSegments: 0, successfulAnalyses: 0, failedAnalyses: 0 },
  });
};
