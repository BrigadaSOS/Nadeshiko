import type {
  ReindexElasticsearch,
  GetQueueStats,
  GetQueueDetails,
  RetryQueueJobs,
  GetFailedJobs,
  PurgeFailedJobs,
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

export const reindexElasticsearch: ReindexElasticsearch = async ({ body }, respond) => {
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

export const getQueueStats: GetQueueStats = async (_1, respond) => {
  const stats = await getStuckJobs();
  return respond.with200().body(stats);
};

export const getQueueDetails: GetQueueDetails = async ({ params }, respond) => {
  const { queueName } = params;
  const details = await fetchQueueDetails(queueName);

  if (!details) {
    throw new NotFoundError(`Queue ${queueName} not found or could not be retrieved`);
  }

  return respond.with200().body(details);
};

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

export const purgeFailedJobs: PurgeFailedJobs = async ({ params }, respond) => {
  const { queueName } = params;
  const purgedCount = await deleteFailedJobs(queueName);

  return respond.with200().body({
    success: true,
    purgedCount,
    message: `Purged ${purgedCount} failed jobs from ${queueName}`,
  });
};

export const retryQueueJobs: RetryQueueJobs = async ({ params }, respond) => {
  const { queueName } = params;
  const retriedCount = await retryFailedJobs(queueName);

  return respond.with200().body({
    success: true,
    retriedCount,
    message: `Retried ${retriedCount} failed jobs from ${queueName}`,
  });
};
