import { PgBoss } from 'pg-boss';
import { registerActivityRetentionWorker } from '@app/workers/activityRetentionWorker';
import { registerEmailWorkers } from '@app/workers/emailWorker';
import { registerEsSyncWorkers } from '@app/workers/esSyncWorker';
import { setBossInstance } from '@app/workers/pgBossClient';
import { registerQueueMetrics } from '@app/workers/workerInstrumentation';
import {
  ALL_QUEUES,
  ACTIVITY_RETENTION_QUEUE,
  EMAIL_SEND_QUEUE,
  ES_SYNC_CREATE_QUEUE,
  ES_SYNC_DELETE_QUEUE,
  ES_SYNC_UPDATE_QUEUE,
} from '@app/workers/queueNames';
import { getAppPostgresConfig } from '@config/postgresConfig';
import { logger } from '@config/log';
import type { RuntimeInitializer } from './types';

let boss: PgBoss | null = null;

export const workersInitializer: RuntimeInitializer = {
  name: 'workers',
  initialize: async () => {
    const { host, port, user, password, database } = getAppPostgresConfig();
    const databaseUrl = `postgresql://${user}:${password}@${host}:${port}/${database}`;

    boss = new PgBoss({
      connectionString: databaseUrl,
      schema: 'pgboss',
      application_name: 'nadeshiko-backend',
      poolSize: 5,  // Limit PgBoss connections (default 10)
      monitorStateIntervalSeconds: 120,  // Poll every 2min instead of 1min
    });

    boss.on('error', (error: Error) => {
      logger.error(`PgBoss error: ${error.message}`);
    });

    await boss.start();

    const queues = [
      {
        name: ES_SYNC_CREATE_QUEUE,
        options: {
          retryLimit: 5,
          retryDelay: 1000,
          retryBackoff: true,
          expireInSeconds: 3600,
          retentionSeconds: 86400,
        },
      },
      {
        name: ES_SYNC_UPDATE_QUEUE,
        options: {
          retryLimit: 5,
          retryDelay: 1000,
          retryBackoff: true,
          expireInSeconds: 3600,
          retentionSeconds: 86400,
        },
      },
      {
        name: ES_SYNC_DELETE_QUEUE,
        options: { retryLimit: 3, retryDelay: 500, retryBackoff: true, expireInSeconds: 3600, retentionSeconds: 86400 },
      },
      {
        name: EMAIL_SEND_QUEUE,
        options: {
          retryLimit: 5,
          retryDelay: 1000,
          retryBackoff: true,
          expireInSeconds: 1800,
          retentionSeconds: 86400,
        },
      },
      {
        name: ACTIVITY_RETENTION_QUEUE,
        options: {
          retryLimit: 3,
          retryDelay: 60000,
          retryBackoff: true,
          expireInSeconds: 3600,
          retentionSeconds: 86400,
        },
      },
    ];

    for (const queue of queues) {
      await boss.createQueue(queue.name, queue.options);
    }

    await boss.schedule(ACTIVITY_RETENTION_QUEUE, '0 3 * * *', {});
    logger.info('PgBoss initialized, queues created, cron scheduled');

    setBossInstance(boss);
    registerQueueMetrics(boss, ALL_QUEUES);

    await registerEsSyncWorkers(boss);
    await registerEmailWorkers(boss);
    await registerActivityRetentionWorker(boss);
  },
  shutdown: async () => {
    if (boss) {
      await boss.stop();
      boss = null;
      logger.info('PgBoss stopped');
    }
  },
};
