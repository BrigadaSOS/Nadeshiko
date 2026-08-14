import { PgBoss, Job } from 'pg-boss';
import { LessThan } from 'typeorm';
import { UserMediaAffinity } from '@app/models/UserMediaAffinity';
import { AccountQuotaUsage } from '@app/models/AccountQuotaUsage';
import { logger } from '@config/log';
import { AFFINITY_RETENTION_QUEUE } from './queueNames';
import { instrumentedHandler } from './workerInstrumentation';

/**
 * How long a month's tally is kept.
 *
 * Deliberately far longer than the 90 days `activityRetentionWorker` keeps
 * activity for: familiarity is the slow signal, and forgetting a show because
 * its owner took a season off is the exact failure this table exists to avoid.
 * Two years also leaves room to widen the 12-month read window later without
 * having thrown the data away first.
 */
const RETENTION_MONTHS = 24;

export async function registerAffinityRetentionWorker(boss: PgBoss): Promise<void> {
  await boss.work(
    AFFINITY_RETENTION_QUEUE,
    instrumentedHandler(AFFINITY_RETENTION_QUEUE, async (_jobs: Job[]) => {
      await handleAffinityRetentionCleanup();
    }),
  );

  logger.info('Affinity retention worker registered');
}

async function handleAffinityRetentionCleanup(): Promise<void> {
  const now = new Date();
  const cutoffDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - RETENTION_MONTHS, 1));
  const cutoffPeriod = AccountQuotaUsage.getCurrentPeriodYyyymm(cutoffDate);

  try {
    const result = await UserMediaAffinity.delete({ periodYyyymm: LessThan(cutoffPeriod) });

    const count = result.affected || 0;
    logger.info({ count, cutoffPeriod }, 'Affinity retention cleanup complete');
  } catch (error) {
    logger.error({ err: error }, 'Error during affinity retention cleanup');
    throw error;
  }
}
