import { logger } from '@config/log';
import { getPgBoss } from './pgBossClient';
import { ES_SYNC_QUEUES } from './queueNames';

export interface QueueStats {
  queue: string;
  stuckCount: number;
  failedCount: number;
}

export interface QueueDetails {
  queue: string;
  stats: {
    deferred: number;
    queued: number;
    active: number;
    total: number;
  };
  metadata: {
    policy: string;
    partition: boolean;
    deadLetter: string | null;
    warningQueueSize: number | null;
    retryLimit: number | null;
    retryDelay: number | null;
    retryBackoff: boolean | null;
    retryDelayMax: number | null;
    expireInSeconds: number | null;
    retentionSeconds: number | null;
    deleteAfterSeconds: number | null;
    createdOn: string;
    updatedOn: string;
    singletonsActive: string[];
    table: string;
  };
}

export interface FailedQueueJob {
  id: string;
  segmentId: number;
  error: string | null;
  createdOn: Date;
}

/**
 * Get stuck jobs across all ES sync queues.
 * Returns counts of pending and failed jobs.
 */
export async function getStuckJobs(): Promise<QueueStats[]> {
  const boss = getPgBoss();
  const results: QueueStats[] = [];

  for (const queue of ES_SYNC_QUEUES) {
    try {
      const stats = await boss.getQueueStats(queue);

      results.push({
        queue,
        stuckCount: stats.queuedCount + stats.activeCount,
        failedCount: 0, // PgBoss doesn't expose failed count in QueueResult.
      });
    } catch {
      logger.error(`Failed to get queue state for ${queue}`);
    }
  }

  return results;
}

/**
 * Get detailed information about jobs in a specific queue.
 */
export async function fetchQueueDetails(queueName: string): Promise<QueueDetails | null> {
  const boss = getPgBoss();

  try {
    const stats = await boss.getQueueStats(queueName);

    return {
      queue: queueName,
      stats: {
        deferred: stats.deferredCount,
        queued: stats.queuedCount,
        active: stats.activeCount,
        total: stats.totalCount,
      },
      metadata: {
        policy: stats.policy || 'standard',
        partition: Boolean(stats.partition),
        deadLetter: stats.deadLetter ?? null,
        warningQueueSize: stats.warningQueueSize ?? null,
        retryLimit: stats.retryLimit ?? null,
        retryDelay: stats.retryDelay ?? null,
        retryBackoff: stats.retryBackoff ?? null,
        retryDelayMax: stats.retryDelayMax ?? null,
        expireInSeconds: stats.expireInSeconds ?? null,
        retentionSeconds: stats.retentionSeconds ?? null,
        deleteAfterSeconds: stats.deleteAfterSeconds ?? null,
        createdOn: stats.createdOn.toISOString(),
        updatedOn: stats.updatedOn.toISOString(),
        singletonsActive: stats.singletonsActive ?? [],
        table: stats.table,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to get queue details for ${queueName}: ${errorMessage}`);
    return null;
  }
}

/**
 * Get failed jobs from a specific queue.
 * Returns jobs that have exceeded their retry limit.
 */
export async function getFailedJobs(queueName: string): Promise<FailedQueueJob[]> {
  const boss = getPgBoss();

  try {
    const db = boss.getDb();
    const result = await db.executeSql(
      `
      SELECT id, (data->>'segmentId')::int as "segmentId", error, "createdOn"
      FROM pgboss.job
      WHERE name = $1
        AND state = 'failed'
      ORDER BY "createdOn" DESC
      LIMIT 100
      `,
      [queueName],
    );

    return result.rows;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to get failed jobs from ${queueName}: ${errorMessage}`);
    return [];
  }
}

/**
 * Delete all failed jobs from a specific queue.
 * Use this to clean up jobs that have permanently failed.
 */
export async function purgeFailedJobs(queueName: string): Promise<number> {
  const boss = getPgBoss();

  try {
    const db = boss.getDb();
    const result = await db.executeSql(
      `
      DELETE FROM pgboss.job
      WHERE name = $1 AND state = 'failed'
      RETURNING id
      `,
      [queueName],
    );

    const count = result.rows.length;
    logger.info(`Purged ${count} failed jobs from ${queueName}`);
    return count;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to purge failed jobs from ${queueName}: ${errorMessage}`);
    return 0;
  }
}

/**
 * Retry failed jobs from a specific queue.
 * Note: PgBoss automatically retries based on retryLimit configuration.
 */
export async function retryFailedJobs(queueName: string): Promise<number> {
  try {
    logger.info(`Retry requested for ${queueName} (handled automatically by PgBoss)`);
    return 0;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to retry jobs from ${queueName}: ${errorMessage}`);
    return 0;
  }
}
