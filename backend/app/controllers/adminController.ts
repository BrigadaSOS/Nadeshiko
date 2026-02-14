import type {
  ReindexElasticsearch,
  GetQueueStats,
  GetQueueDetails,
  RetryQueueJobs,
  GetFailedJobs,
  PurgeFailedJobs,
  MorphemeBackfill,
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
import { Segment } from '@app/models';
import { IsNull } from 'typeorm';
// TEMPORARILY DISABLED - lindera.js dependency removed
// import { analyzeBatch } from '@app/services/linderaClient';
import { AppDataSource } from '@config/database';
import { logger } from '@config/log';

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

export const morphemeBackfill: MorphemeBackfill = async (_1, respond) => {
  // TEMPORARILY DISABLED - lindera.js dependency removed
  const errorMessage = 'Morpheme analysis temporarily disabled - lindera.js dependency removed';
  logger.warn(errorMessage);
  return respond.with200().body({
    success: false,
    message: errorMessage,
    stats: { totalSegments: 0, successfulAnalyses: 0, failedAnalyses: 0 },
  });

  // const BATCH_SIZE = 100;
  // const stats = { totalSegments: 0, successfulAnalyses: 0, failedAnalyses: 0 };
  //
  // try {
  //   const segments = await Segment.find({
  //     where: { morphemes: IsNull() },
  //     select: ['id', 'contentJa'],
  //   });
  //
  //   stats.totalSegments = segments.length;
  //   logger.info(`Morpheme backfill: ${segments.length} segments to process`);
  //
  //   for (let i = 0; i < segments.length; i += BATCH_SIZE) {
  //     const batch = segments.slice(i, i + BATCH_SIZE);
  //     const items = batch.map((s) => ({ id: String(s.id), text: s.contentJa }));
  //
  //     try {
  //       const results = await analyzeBatch(items);
  //
  //       for (const result of results) {
  //         await AppDataSource.createQueryBuilder()
  //           .update(Segment)
  //           .set({ morphemes: result.morphemes })
  //           .where('id = :id', { id: Number(result.id) })
  //           .execute();
  //         stats.successfulAnalyses++;
  //       }
  //     } catch (error) {
  //       logger.error({ err: error, batchStart: i }, 'Morpheme backfill batch failed');
  //       stats.failedAnalyses += batch.length;
  //     }
  //   }
  //
  //   const message = `Backfill completed: ${stats.successfulAnalyses}/${stats.totalSegments} segments analyzed`;
  //   logger.info(message);
  //
  //   return respond.with200().body({ success: true, message, stats });
  // } catch (error) {
  //   const errorMessage = error instanceof Error ? error.message : String(error);
  //   logger.error(`Morpheme backfill failed: ${errorMessage}`);
  //   return respond.with200().body({ success: false, message: errorMessage, stats });
  // }
};
