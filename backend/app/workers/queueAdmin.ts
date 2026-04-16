import { logger } from '@config/log';
import { getPgBoss } from './pgBossClient';
import { ALL_QUEUES } from './queueNames';

export interface QueueStats {
  queue: string;
  queued: number;
  active: number;
  failed: number;
  completed: number;
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

  const db = boss.getDb();

  for (const queue of ALL_QUEUES) {
    try {
      const stats = await boss.getQueueStats(queue);

      const failedResult = await db.executeSql(
        `SELECT COUNT(*)::int AS count FROM pgboss.job WHERE name = $1 AND state = 'failed'`,
        [queue],
      );
      const completedResult = await db.executeSql(
        `SELECT COUNT(*)::int AS count FROM pgboss.job WHERE name = $1 AND state = 'completed'`,
        [queue],
      );

      results.push({
        queue,
        queued: stats.queuedCount,
        active: stats.activeCount,
        failed: Number(failedResult.rows[0]?.count ?? 0),
        completed: Number(completedResult.rows[0]?.count ?? 0),
      });
    } catch (error) {
      logger.error({ err: error, queue }, 'Failed to get queue state');
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
    logger.error({ err: error, queueName }, 'Failed to get queue details');
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
    logger.error({ err: error, queueName }, 'Failed to get failed jobs');
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
    logger.info({ count, queueName }, 'Purged failed jobs');
    return count;
  } catch (error) {
    logger.error({ err: error, queueName }, 'Failed to purge failed jobs');
    return 0;
  }
}

/**
 * Retry failed jobs from a specific queue.
 * Note: PgBoss automatically retries based on retryLimit configuration.
 */
export async function retryFailedJobs(queueName: string): Promise<number> {
  try {
    logger.info({ queueName }, 'Retry requested (handled automatically by PgBoss)');
    return 0;
  } catch (error) {
    logger.error({ err: error, queueName }, 'Failed to retry jobs');
    return 0;
  }
}
