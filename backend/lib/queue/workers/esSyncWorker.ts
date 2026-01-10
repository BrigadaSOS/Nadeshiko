import { PgBoss, Job } from 'pg-boss';
import { createSegmentInES, updateSegmentInES, deleteSegmentFromES } from '@app/services/elasticsearchSync';
import { Segment } from '@app/entities';
import { logger } from '@lib/utils/log';
import type { EsSyncJobData } from '../pgBoss';

export async function registerEsSyncWorkers(boss: PgBoss): Promise<void> {
  // Handler for CREATE operations
  await boss.work('es-sync-create', async (jobs: Job<EsSyncJobData>[]) => {
    for (const job of jobs) {
      await handleCreateJob(job);
    }
  });

  // Handler for UPDATE operations
  await boss.work('es-sync-update', async (jobs: Job<EsSyncJobData>[]) => {
    for (const job of jobs) {
      await handleUpdateJob(job);
    }
  });

  // Handler for DELETE operations
  await boss.work('es-sync-delete', async (jobs: Job<EsSyncJobData>[]) => {
    for (const job of jobs) {
      await handleDeleteJob(job);
    }
  });

  logger.info('ES sync workers registered');
}

async function handleCreateJob(job: Job<EsSyncJobData>): Promise<void> {
  const { segmentId } = job.data;

  try {
    const segment = await Segment.findOne({ where: { id: segmentId } });
    if (!segment) {
      logger.warn(`Segment ${segmentId} not found for CREATE, skipping`);
      return;
    }

    const success = await createSegmentInES(segment);

    if (!success) {
      throw new Error(`Failed to create segment ${segmentId} in ES`);
    }

    logger.info(`Successfully created segment ${segmentId} in ES`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error processing CREATE job for segment ${segmentId}: ${errorMessage}`);
    throw error; // Re-throw to trigger pg-boss retry
  }
}

async function handleUpdateJob(job: Job<EsSyncJobData>): Promise<void> {
  const { segmentId } = job.data;

  try {
    const segment = await Segment.findOne({ where: { id: segmentId } });
    if (!segment) {
      // Segment may have been deleted - this is not an error for UPDATE jobs
      logger.warn(`Segment ${segmentId} not found for UPDATE (may have been deleted), skipping`);
      return;
    }

    const success = await updateSegmentInES(segment);

    if (!success) {
      throw new Error(`Failed to update segment ${segmentId} in ES`);
    }

    logger.info(`Successfully updated segment ${segmentId} in ES`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error processing UPDATE job for segment ${segmentId}: ${errorMessage}`);
    throw error; // Re-throw to trigger pg-boss retry
  }
}

async function handleDeleteJob(job: Job<EsSyncJobData>): Promise<void> {
  const { segmentId } = job.data;

  try {
    const success = await deleteSegmentFromES(segmentId);

    if (!success) {
      throw new Error(`Failed to delete segment ${segmentId} from ES`);
    }

    logger.info(`Successfully deleted segment ${segmentId} from ES`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error processing DELETE job for segment ${segmentId}: ${errorMessage}`);
    throw error; // Re-throw to trigger pg-boss retry
  }
}
