import { PgBoss, Job } from 'pg-boss';
import { Segment } from '@app/models';
import { SegmentDocument } from '@app/services/search/SegmentDocument';
import { SegmentIndexer } from '@app/services/search/segmentDocument/SegmentIndexer';
import { logger } from '@config/log';
import { Cache } from '@lib/cache';
import { In } from 'typeorm';
import type { EsSyncJobData } from './esSyncQueue';
import { ES_SYNC_CREATE_QUEUE, ES_SYNC_DELETE_QUEUE, ES_SYNC_UPDATE_QUEUE } from './queueNames';
import { instrumentedHandler } from './workerInstrumentation';

/**
 * Search stats (per-title and per-episode counts) are cached for a day, and segment writes reach Elasticsearch only
 * here, asynchronously. Clearing the cache when the request is made is too early: a stats request in the minute an
 * upload takes to index froze a partial count (one chapter missing) for the rest of the day. Clear it once documents
 * actually changed in the index.
 */
function invalidateSearchStats(): void {
  Cache.invalidate(SegmentDocument.SEARCH_STATS_CACHE);
}

export async function registerEsSyncWorkers(boss: PgBoss): Promise<void> {
  const workerOptions = {
    batchSize: 100,
    teamSize: 3,
  };

  await boss.work(
    ES_SYNC_CREATE_QUEUE,
    workerOptions,
    instrumentedHandler(ES_SYNC_CREATE_QUEUE, async (jobs: Job<EsSyncJobData>[]) => {
      await handleBulkIndex(jobs, 'CREATE');
    }),
  );

  await boss.work(
    ES_SYNC_UPDATE_QUEUE,
    workerOptions,
    instrumentedHandler(ES_SYNC_UPDATE_QUEUE, async (jobs: Job<EsSyncJobData>[]) => {
      await handleBulkIndex(jobs, 'UPDATE');
    }),
  );

  await boss.work(
    ES_SYNC_DELETE_QUEUE,
    workerOptions,
    instrumentedHandler(ES_SYNC_DELETE_QUEUE, async (jobs: Job<EsSyncJobData>[]) => {
      await handleBulkDelete(jobs);
    }),
  );

  logger.info('ES sync workers registered with batchSize=100, teamSize=3');
}

async function handleBulkIndex(jobs: Job<EsSyncJobData>[], operation: 'CREATE' | 'UPDATE'): Promise<void> {
  const segmentIds = jobs.map((j) => j.data.segmentId);

  try {
    const segments = await Segment.find({ where: { id: In(segmentIds) } });

    const foundIds = new Set(segments.map((s) => s.id));
    const missingIds = segmentIds.filter((id) => !foundIds.has(id));

    if (missingIds.length > 0) {
      logger.warn({ operation, missingIds }, 'Segments not found for operation');
    }

    if (segments.length === 0) return;

    const result = await SegmentIndexer.bulkIndex(segments);
    if (result.succeeded > 0) invalidateSearchStats();

    for (const err of result.errors) {
      logger.warn({ operation, segmentId: err.segmentId, error: err.error }, 'Bulk operation failed for segment');
    }

    if (result.failed > 0) {
      // Throw after a failed bulk write so pg-boss retries; segment-id idempotence makes retrying the batch safe and
      // keeps outcomes truthful.
      throw new Error(`${result.failed} segment(s) failed during bulk ${operation}`);
    }
  } catch (error) {
    logger.error({ err: error, segmentIds, operation }, 'Error processing ES batch');
    throw error;
  }
}

async function handleBulkDelete(jobs: Job<EsSyncJobData>[]): Promise<void> {
  const segmentIds = jobs.map((j) => j.data.segmentId);

  try {
    const result = await SegmentIndexer.bulkDelete(segmentIds);
    if (result.succeeded > 0) invalidateSearchStats();

    for (const err of result.errors) {
      logger.warn({ segmentId: err.segmentId, error: err.error }, 'Bulk DELETE failed for segment');
    }

    if (result.failed > 0) {
      throw new Error(`${result.failed} segment(s) failed during bulk DELETE`);
    }
  } catch (error) {
    logger.error({ err: error, segmentIds }, 'Error processing ES DELETE batch');
    throw error;
  }
}
