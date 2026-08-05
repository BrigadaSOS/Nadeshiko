import { PgBoss, Job } from 'pg-boss';
import { UserActivity } from '@app/models/UserActivity';
import { LessThan } from 'typeorm';
import { logger } from '@config/log';
import { ACTIVITY_RETENTION_QUEUE } from './queueNames';
import { instrumentedHandler } from './workerInstrumentation';

export async function registerActivityRetentionWorker(boss: PgBoss): Promise<void> {
  await boss.work(
    ACTIVITY_RETENTION_QUEUE,
    instrumentedHandler(ACTIVITY_RETENTION_QUEUE, async (_jobs: Job[]) => {
      await handleRetentionCleanup();
    }),
  );

  logger.info('Activity retention worker registered');
}

async function handleRetentionCleanup(): Promise<void> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 90);

  try {
    const result = await UserActivity.delete({
      createdAt: LessThan(cutoffDate),
    });

    const count = result.affected || 0;
    logger.info({ count }, 'Activity retention cleanup complete');
  } catch (error) {
    logger.error({ err: error }, 'Error during activity retention cleanup');
    throw error;
  }
}
