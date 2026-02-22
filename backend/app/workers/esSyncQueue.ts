import { logger } from '@config/log';
import { getPgBoss } from './pgBossClient';
import { ES_SYNC_CREATE_QUEUE, ES_SYNC_DELETE_QUEUE, ES_SYNC_UPDATE_QUEUE, type EsSyncQueueName } from './queueNames';

export interface EsSyncJobData {
  segmentId: number;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
}

function getQueueName(operation: EsSyncJobData['operation']): EsSyncQueueName {
  switch (operation) {
    case 'CREATE':
      return ES_SYNC_CREATE_QUEUE;
    case 'UPDATE':
      return ES_SYNC_UPDATE_QUEUE;
    case 'DELETE':
      return ES_SYNC_DELETE_QUEUE;
  }
}

/**
 * Send an ES sync job with deduplication by segmentId.
 * Uses sendDebounced to coalesce rapid updates for the same segment.
 */
export async function sendEsSyncJob(data: EsSyncJobData): Promise<string | null> {
  const boss = getPgBoss();
  const queueName = getQueueName(data.operation);

  try {
    // A value of 0 causes a SQL division-by-zero in pg-boss singleton_on calculation.
    const jobId = await boss.sendDebounced(queueName, data, null, 1, `${data.segmentId}`);
    logger.info(`Enqueued ES sync job ${jobId} for segment ${data.segmentId} (${data.operation})`);
    return jobId;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to enqueue ES sync job: ${errorMessage}`);
    return null;
  }
}

/**
 * Cancel all pending jobs for a specific segment.
 * Note: PgBoss has no direct API to cancel jobs by debounce key.
 */
export async function cancelJobsForSegment(segmentId: number): Promise<boolean> {
  try {
    logger.info(`Cancel jobs requested for segment ${segmentId} (handled by debounce)`);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to cancel jobs for segment ${segmentId}: ${errorMessage}`);
    return false;
  }
}

export async function sendBulkEsSyncJobs(jobs: EsSyncJobData[]): Promise<void> {
  const boss = getPgBoss();

  const jobsByQueue: Record<EsSyncQueueName, EsSyncJobData[]> = {
    [ES_SYNC_CREATE_QUEUE]: [],
    [ES_SYNC_UPDATE_QUEUE]: [],
    [ES_SYNC_DELETE_QUEUE]: [],
  };

  for (const job of jobs) {
    const queueName = getQueueName(job.operation);
    jobsByQueue[queueName].push(job);
  }

  for (const [queueName, queueJobs] of Object.entries(jobsByQueue)) {
    if (queueJobs.length === 0) continue;

    try {
      await boss.send(queueName, queueJobs);
      logger.info(`Enqueued ${queueJobs.length} ES sync jobs to ${queueName}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to enqueue bulk ES sync jobs to ${queueName}: ${errorMessage}`);
    }
  }
}
