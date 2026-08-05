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
  const queueName = getQueueName(data.operation);

  try {
    const boss = getPgBoss();
    // A value of 0 causes a SQL division-by-zero in pg-boss singleton_on calculation.
    const jobId = await boss.sendDebounced(queueName, data, null, 1, `${data.segmentId}`);
    logger.info({ jobId, segmentId: data.segmentId, operation: data.operation }, 'Enqueued ES sync job');
    return jobId;
  } catch (error) {
    logger.error({ err: error }, 'Failed to enqueue ES sync job');
    return null;
  }
}

/**
 * Enqueue one job per segment, grouped by queue.
 *
 * `insert` and not `send`: `send(queue, jobs)` stores the whole array as a single
 * job's payload, and the workers read a batch as one job per segment
 * (`jobs.map((j) => j.data.segmentId)`), so every id came back undefined and
 * nothing was ever indexed or removed. `insert` is the batch API — one row per
 * entry, each with its own `data`.
 */
export async function sendBulkEsSyncJobs(jobs: EsSyncJobData[]): Promise<void> {
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
      const boss = getPgBoss();
      await boss.insert(
        queueName,
        queueJobs.map((data) => ({ data })),
      );
      logger.info({ count: queueJobs.length, queueName }, 'Enqueued bulk ES sync jobs');
    } catch (error) {
      logger.error({ err: error, queueName }, 'Failed to enqueue bulk ES sync jobs');
    }
  }
}
