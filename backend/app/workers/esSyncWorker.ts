import { PgBoss, Job } from 'pg-boss';
import { Segment } from '@app/models';
import { SegmentIndexer } from '@app/models/segmentDocument/SegmentIndexer';
import { logger } from '@config/log';
import { In } from 'typeorm';
import type { EsSyncJobData } from './esSyncQueue';
import { ES_SYNC_CREATE_QUEUE, ES_SYNC_DELETE_QUEUE, ES_SYNC_UPDATE_QUEUE } from './queueNames';

export async function registerEsSyncWorkers(boss: PgBoss): Promise<void> {
  const workerOptions = {
    batchSize: 20,
    teamSize: 3,
  };

  await boss.work(ES_SYNC_CREATE_QUEUE, workerOptions, async (jobs: Job<EsSyncJobData>[]) => {
    await handleBulkIndex(jobs, 'CREATE');
  });

  await boss.work(ES_SYNC_UPDATE_QUEUE, workerOptions, async (jobs: Job<EsSyncJobData>[]) => {
    await handleBulkIndex(jobs, 'UPDATE');
  });

  await boss.work(ES_SYNC_DELETE_QUEUE, workerOptions, async (jobs: Job<EsSyncJobData>[]) => {
    await handleBulkDelete(jobs);
  });

  logger.info('ES sync workers registered with batchSize=20, teamSize=3');
}

async function handleBulkIndex(jobs: Job<EsSyncJobData>[], operation: 'CREATE' | 'UPDATE'): Promise<void> {
  const segmentIds = jobs.map((j) => j.data.segmentId);

  try {
    const segments = await Segment.find({ where: { id: In(segmentIds) } });

    const foundIds = new Set(segments.map((s) => s.id));
    const missingIds = segmentIds.filter((id) => !foundIds.has(id));

    if (missingIds.length > 0) {
      const label = operation === 'UPDATE' ? '(may have been deleted)' : '';
      logger.warn(`Segments not found for ${operation} ${label}: ${missingIds.join(', ')}`);
    }

    if (segments.length === 0) return;

    const result = await SegmentIndexer.bulkIndex(segments);

    for (const err of result.errors) {
      logger.warn(`Bulk ${operation} failed for segment ${err.segmentId}: ${err.error}`);
    }

    if (result.succeeded === 0 && result.failed > 0) {
      throw new Error(`All ${result.failed} segments failed during bulk ${operation}`);
    }
  } catch (error) {
    logger.error({ err: error, segmentIds }, `Error processing ES ${operation} batch`);
    throw error;
  }
}

async function handleBulkDelete(jobs: Job<EsSyncJobData>[]): Promise<void> {
  const segmentIds = jobs.map((j) => j.data.segmentId);

  try {
    const result = await SegmentIndexer.bulkDelete(segmentIds);

    for (const err of result.errors) {
      logger.warn(`Bulk DELETE failed for segment ${err.segmentId}: ${err.error}`);
    }

    if (result.succeeded === 0 && result.failed > 0) {
      throw new Error(`All ${result.failed} segments failed during bulk DELETE`);
    }
  } catch (error) {
    logger.error({ err: error, segmentIds }, 'Error processing ES DELETE batch');
    throw error;
  }
}
