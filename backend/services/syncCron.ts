import { retryFailedSyncs } from './elasticsearchSync';
import { logger } from '../utils/log';

// Default 5 minutes, configurable via ENV variable (in milliseconds)
const CRON_INTERVAL_MS = parseInt(process.env.SYNC_CRON_INTERVAL_MS || '300000', 10);

let cronInterval: NodeJS.Timeout | null = null;

/**
 * Start the sync cron job
 */
export function startSyncCron(): void {
  if (cronInterval) {
    logger.warn('Sync cron is already running');
    return;
  }

  logger.info('Starting Elasticsearch sync cron job');

  // Run immediately on start
  retryFailedSyncs().catch((error) => {
    logger.error('Error in initial sync retry:', error);
  });

  // Then run at configured interval
  cronInterval = setInterval(() => {
    retryFailedSyncs().catch((error) => {
      logger.error('Error in sync cron:', error);
    });
  }, CRON_INTERVAL_MS);

  logger.info(`Sync cron job started (interval: ${CRON_INTERVAL_MS}ms = ${CRON_INTERVAL_MS / 60000} minutes)`);
}

/**
 * Stop the sync cron job
 */
export function stopSyncCron(): void {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
    logger.info('Sync cron job stopped');
  }
}

/**
 * Get the status of the sync cron job
 */
export function isSyncCronRunning(): boolean {
  return cronInterval !== null;
}
