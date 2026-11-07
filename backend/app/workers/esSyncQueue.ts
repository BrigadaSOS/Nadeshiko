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
/** Enqueue attempts and the pause before each retry: a lost enqueue leaves the segment out of search until the next
 * full reindex, so a database blip of a few seconds must not be enough to lose one. */
const ENQUEUE_ATTEMPTS = 4;
const ENQUEUE_BACKOFF_MS = [250, 1000, 3000];

async function withEnqueueRetry<T>(what: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ENQUEUE_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === ENQUEUE_ATTEMPTS) break;
      logger.warn({ err: error, attempt, what }, 'ES sync enqueue failed; retrying');
      await new Promise((resolve) => setTimeout(resolve, ENQUEUE_BACKOFF_MS[attempt - 1]));
    }
  }
  throw lastError;
}

export async function sendEsSyncJob(data: EsSyncJobData): Promise<string | null> {
  const queueName = getQueueName(data.operation);

  try {
    const boss = getPgBoss();
    // A value of 0 causes a SQL division-by-zero in pg-boss singleton_on calculation.
    const jobId = await withEnqueueRetry(queueName, () =>
      boss.sendDebounced(queueName, data, null, 1, `${data.segmentId}`),
    );
    logger.info({ jobId, segmentId: data.segmentId, operation: data.operation }, 'Enqueued ES sync job');
    return jobId;
  } catch (error) {
    logger.error(
      { err: error, segmentId: data.segmentId, operation: data.operation },
      'Failed to enqueue ES sync job after retries; the segment is out of sync with search',
    );
    return null;
  }
}

/** Use pg-boss `insert`, not `send(queue, jobs)`: `send` stores the array as one payload, while workers expect one
 * job per segment. Returns false when some jobs could not be queued even after retries, so a caller that can retry
 * its own work (a pg-boss handler) can throw instead of dropping them. */
export async function sendBulkEsSyncJobs(jobs: EsSyncJobData[]): Promise<boolean> {
  const jobsByQueue: Record<EsSyncQueueName, EsSyncJobData[]> = {
    [ES_SYNC_CREATE_QUEUE]: [],
    [ES_SYNC_UPDATE_QUEUE]: [],
    [ES_SYNC_DELETE_QUEUE]: [],
  };

  for (const job of jobs) {
    const queueName = getQueueName(job.operation);
    jobsByQueue[queueName].push(job);
  }

  let allQueued = true;
  for (const [queueName, queueJobs] of Object.entries(jobsByQueue)) {
    if (queueJobs.length === 0) continue;

    try {
      const boss = getPgBoss();
      await withEnqueueRetry(queueName, () =>
        boss.insert(
          queueName,
          queueJobs.map((data) => ({ data })),
        ),
      );
      logger.info({ count: queueJobs.length, queueName }, 'Enqueued bulk ES sync jobs');
    } catch (error) {
      allQueued = false;
      logger.error(
        { err: error, queueName, count: queueJobs.length, segmentIds: queueJobs.map((job) => job.segmentId) },
        'Failed to enqueue bulk ES sync jobs after retries; these segments are out of sync with search',
      );
    }
  }
  return allQueued;
}
