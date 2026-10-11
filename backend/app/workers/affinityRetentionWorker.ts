import { PgBoss, Job } from 'pg-boss';
import { LessThan } from 'typeorm';
import { UserMediaAffinity } from '@app/models/UserMediaAffinity';
import { AccountQuotaUsage } from '@app/models/AccountQuotaUsage';
import { logger } from '@config/log';
import { AFFINITY_RETENTION_QUEUE } from './queueNames';
import { instrumentedHandler } from './workerInstrumentation';

/** Retain familiarity longer than activity; a seasonal break must not make a known title look new. */
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
