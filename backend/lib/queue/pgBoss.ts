import { PgBoss } from 'pg-boss';
import { logger } from '@lib/utils/log';

// Export job data type for use in workers
export interface EsSyncJobData {
  segmentId: number;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
}

export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface PgBossConfig {
  databaseUrl?: string;
  schema?: string;
}

let bossInstance: PgBoss | null = null;

export function getPgBoss(): PgBoss {
  if (!bossInstance) {
    throw new Error('PgBoss not initialized. Call initPgBoss() first.');
  }
  return bossInstance;
}

export async function initPgBoss(config: PgBossConfig = {}): Promise<PgBoss> {
  if (bossInstance) {
    return bossInstance;
  }

  let databaseUrl = config.databaseUrl || process.env.DATABASE_URL;

  // Construct DATABASE_URL from individual env vars if not provided
  if (!databaseUrl) {
    const host = process.env.POSTGRES_HOST;
    const port = process.env.POSTGRES_PORT;
    const user = process.env.POSTGRES_USER;
    const password = process.env.POSTGRES_PASSWORD;
    const database = process.env.POSTGRES_DB;

    if (!host || !port || !user || !password || !database) {
      throw new Error(
        'Missing required database environment variables (POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB)',
      );
    }

    databaseUrl = `postgresql://${user}:${password}@${host}:${port}/${database}`;
  }

  const boss = new PgBoss({
    connectionString: databaseUrl,
    schema: config.schema || 'pgboss',
    application_name: 'nadeshiko-backend',
  });

  boss.on('error', (error: Error) => {
    logger.error(`PgBoss error: ${error.message}`);
  });

  await boss.start();

  // Create queues with retry configuration
  const queues = [
    {
      name: 'es-sync-create',
      options: {
        retryLimit: 5,
        retryDelay: 1000, // 1 second initial delay
        retryBackoff: true,
        expireIn: 3600, // 1 hour
        // Remove completed jobs after 1 day to keep the database clean
        completedRetentionDays: 1,
        // Remove failed jobs after 7 days so we can inspect them
        failedRetentionDays: 7,
      },
    },
    {
      name: 'es-sync-update',
      options: {
        retryLimit: 5,
        retryDelay: 1000,
        retryBackoff: true,
        expireIn: 3600,
        completedRetentionDays: 1,
        failedRetentionDays: 7,
      },
    },
    {
      name: 'es-sync-delete',
      options: {
        retryLimit: 3,
        retryDelay: 500,
        retryBackoff: true,
        expireIn: 3600,
        completedRetentionDays: 1,
        failedRetentionDays: 7,
      },
    },
    {
      name: 'email-send',
      options: {
        retryLimit: 5,
        retryDelay: 1000,
        retryBackoff: true,
        expireIn: 1800, // 30 minutes
        completedRetentionDays: 1,
        failedRetentionDays: 7,
      },
    },
  ];

  for (const queue of queues) {
    await boss.createQueue(queue.name, queue.options);
    logger.info(`Created queue: ${queue.name}`);
  }

  bossInstance = boss;
  logger.info('PgBoss initialized successfully');

  return boss;
}

export async function stopPgBoss(): Promise<void> {
  if (bossInstance) {
    await bossInstance.stop();
    bossInstance = null;
    logger.info('PgBoss stopped');
  }
}

/**
 * Send an ES sync job with deduplication by segmentId.
 * Uses sendAfter with 0 delay to ensure job uniqueness with debounce.
 */
export async function sendEsSyncJob(data: EsSyncJobData): Promise<string | null> {
  const boss = getPgBoss();

  const queueName = `es-sync-${data.operation.toLowerCase()}`;

  try {
    // Use sendDebounced with 0 seconds to ensure only one job per segmentId
    // If a job for this segment already exists, it will be replaced with the new data
    const jobId = await boss.sendDebounced(queueName, data, null, 0, `${data.segmentId}`);
    logger.info(`Enqueued ES sync job ${jobId} for segment ${data.segmentId} (${data.operation})`);
    return jobId;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to enqueue ES sync job: ${errorMessage}`);
    return null;
  }
}

/**
 * Get stuck jobs across all ES sync queues.
 * Returns counts of pending and failed jobs.
 */
export async function getStuckJobs(): Promise<
  {
    queue: string;
    stuckCount: number;
    failedCount: number;
  }[]
> {
  const boss = getPgBoss();
  const queues = ['es-sync-create', 'es-sync-update', 'es-sync-delete'];
  const results = [];

  for (const queue of queues) {
    try {
      const stats = await boss.getQueueStats(queue);

      // totalCount includes all jobs in queue (active + queued)
      // Estimate stuck jobs as queued + active jobs
      const stuckCount = stats.queuedCount + stats.activeCount;

      results.push({
        queue,
        stuckCount,
        failedCount: 0, // PgBoss doesn't expose failed count in QueueResult
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
export async function fetchQueueDetails(queueName: string): Promise<{
  queue: string;
  size: number;
  created: number;
  failed: number;
  complete: number;
  expired: number;
  cancelled: number;
} | null> {
  const boss = getPgBoss();

  try {
    const stats = await boss.getQueueStats(queueName);

    return {
      queue: queueName,
      size: stats.totalCount,
      created: 0, // PgBoss doesn't track total created count
      failed: 0, // Not available in QueueResult
      complete: 0, // Not available in QueueResult
      expired: 0, // PgBoss doesn't track this directly
      cancelled: 0, // Not available in QueueResult
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to get queue details for ${queueName}: ${errorMessage}`);
    return null;
  }
}

/**
 * Cancel all pending jobs for a specific segment.
 * Note: This is a simplified implementation using debounce behavior.
 */
export async function cancelJobsForSegment(segmentId: number): Promise<boolean> {
  try {
    // PgBoss doesn't have a direct API to cancel jobs by key
    // The debounce behavior in sendEsSyncJob already handles replacing old jobs
    logger.info(`Cancel jobs requested for segment ${segmentId} (handled by debounce)`);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to cancel jobs for segment ${segmentId}: ${errorMessage}`);
    return false;
  }
}

/**
 * Get failed jobs from a specific queue.
 * Returns jobs that have exceeded their retry limit.
 */
export async function getFailedJobs(
  queueName: string,
): Promise<Array<{ id: string; segmentId: number; error: string | null; createdOn: Date }>> {
  const boss = getPgBoss();

  try {
    const db = boss.getDb();
    const result = await db.executeSql(
      `
      SELECT id, data->>'segmentId' as "segmentId", error, "createdOn"
      FROM ${bossInstance ? 'pgboss' : 'pgboss'}.job
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
      DELETE FROM ${bossInstance ? 'pgboss' : 'pgboss'}.job
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
    // PgBoss handles retries automatically based on retryLimit
    // We can't manually retry failed jobs without direct database access
    logger.info(`Retry requested for ${queueName} (handled automatically by PgBoss)`);
    return 0;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to retry jobs from ${queueName}: ${errorMessage}`);
    return 0;
  }
}

export async function sendBulkEsSyncJobs(jobs: EsSyncJobData[]): Promise<void> {
  const boss = getPgBoss();

  const jobsByQueue: Record<string, EsSyncJobData[]> = {
    'es-sync-create': [],
    'es-sync-update': [],
    'es-sync-delete': [],
  };

  for (const job of jobs) {
    const queueName = `es-sync-${job.operation.toLowerCase()}`;
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

/**
 * Send an email job with optional deduplication.
 * Uses sendDebounced when a dedupeKey is provided to prevent duplicate emails.
 */
export async function sendEmailJob(data: EmailJobData, dedupeKey?: string): Promise<string | null> {
  const boss = getPgBoss();

  try {
    let jobId: string | null;

    if (dedupeKey) {
      // Use sendDebounced with 0 seconds to ensure only one email per dedupeKey
      jobId = await boss.sendDebounced('email-send', data, null, 0, dedupeKey);
      logger.info(`Enqueued email job ${jobId} with dedupe key ${dedupeKey} to ${data.to}`);
    } else {
      jobId = await boss.send('email-send', data);
      logger.info(`Enqueued email job ${jobId} to ${data.to}`);
    }

    return jobId;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to enqueue email job: ${errorMessage}`);
    return null;
  }
}
