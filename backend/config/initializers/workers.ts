import { PgBoss } from 'pg-boss';
import { registerActivityRetentionWorker } from '@app/workers/activityRetentionWorker';
import { registerAffinityRetentionWorker } from '@app/workers/affinityRetentionWorker';
import { registerEmailWorkers } from '@app/workers/emailWorker';
import { registerEmailLifecycleWorker } from '@app/workers/emailLifecycleWorker';
import { registerEsSyncWorkers } from '@app/workers/esSyncWorker';
import { registerTokenParseWorker } from '@app/workers/tokenParseWorker';
import { setBossInstance } from '@app/workers/pgBossClient';
import { registerQueueMetrics } from '@app/workers/workerInstrumentation';
import {
  ALL_QUEUES,
  ACTIVITY_RETENTION_QUEUE,
  AFFINITY_RETENTION_QUEUE,
  EMAIL_SEND_QUEUE,
  EMAIL_LIFECYCLE_QUEUE,
  ES_SYNC_CREATE_QUEUE,
  ES_SYNC_DELETE_QUEUE,
  ES_SYNC_UPDATE_QUEUE,
  TOKEN_PARSE_QUEUE,
  TOKEN_SWEEP_QUEUE,
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
      monitorIntervalSeconds: 120, // Poll every 2min instead of 1min
    });

    boss.on('error', (error: Error) => {
      logger.error({ err: error }, 'PgBoss error');
    });

    await boss.start();

    const queues = [
      {
        name: ES_SYNC_CREATE_QUEUE,
        options: {
          retryLimit: 5,
          // pg-boss measures retryDelay in seconds, not milliseconds.
          retryDelay: 1,
          retryBackoff: true,
          expireInSeconds: 3600,
          retentionSeconds: 86400,
        },
      },
      {
        name: ES_SYNC_UPDATE_QUEUE,
        options: {
          retryLimit: 5,
          retryDelay: 1,
          retryBackoff: true,
          expireInSeconds: 3600,
          retentionSeconds: 86400,
        },
      },
      {
        name: ES_SYNC_DELETE_QUEUE,
        options: { retryLimit: 3, retryDelay: 1, retryBackoff: true, expireInSeconds: 3600, retentionSeconds: 86400 },
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
        name: EMAIL_LIFECYCLE_QUEUE,
        options: {
          // One retry covers a transient DB failure; beyond that a query failure should wait for tomorrow’s sweep
          // rather than repeat indefinitely.
          retryLimit: 1,
          retryDelay: 300000,
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
      {
        name: AFFINITY_RETENTION_QUEUE,
        options: {
          retryLimit: 3,
          retryDelay: 60000,
          retryBackoff: true,
          expireInSeconds: 3600,
          retentionSeconds: 86400,
        },
      },
      {
        name: TOKEN_PARSE_QUEUE,
        options: {
          // Retry the outer Shirabe pull across deploy/502/timeout failures; `parseSegments` already retries individual
          // chunks.
          retryLimit: 5,
          retryDelay: 30000,
          retryBackoff: true,
          // Generous next to the ES queues' hour. A full pull is 500 sentences
          // and the adaptive limiter drops to one chunk at a time when Shirabe
          // is under load, which is exactly when a tighter expiry would start
          // killing work that was going to succeed.
          expireInSeconds: 3600,
          retentionSeconds: 86400,
        },
      },
      {
        name: TOKEN_SWEEP_QUEUE,
        options: {
          // This query sweep gets one retry for a DB blip; later failures wait for tomorrow.
          retryLimit: 1,
          retryDelay: 300000,
          expireInSeconds: 1800,
          retentionSeconds: 86400,
        },
      },
    ];

    for (const queue of queues) {
      await boss.createQueue(queue.name, queue.options);
    }

    // Update the three ES queues explicitly; `createQueue` leaves existing queues unchanged.
    for (const queueName of [ES_SYNC_CREATE_QUEUE, ES_SYNC_UPDATE_QUEUE, ES_SYNC_DELETE_QUEUE]) {
      await boss.updateQueue(queueName, { retryDelay: 1 });
    }

    await boss.schedule(ACTIVITY_RETENTION_QUEUE, '0 3 * * *', {});
    // An hour after the activity sweep, so the two nightly deletes do not
    // contend for the same window.
    await boss.schedule(AFFINITY_RETENTION_QUEUE, '0 4 * * *', {});
    // Run the affinity sweep before the recap so month-boundary tallies are complete.
    await boss.schedule(EMAIL_LIFECYCLE_QUEUE, '0 5 * * *', {});
    // Run this last so it cannot queue work for rows the retention sweep is about to delete.
    await boss.schedule(TOKEN_SWEEP_QUEUE, '0 6 * * *', {});
    logger.info('PgBoss initialized, queues created, cron scheduled');

    setBossInstance(boss);
    registerQueueMetrics(boss, ALL_QUEUES);

    await registerEsSyncWorkers(boss);
    await registerEmailWorkers(boss);
    await registerEmailLifecycleWorker(boss);
    await registerActivityRetentionWorker(boss);
    await registerAffinityRetentionWorker(boss);
    await registerTokenParseWorker(boss);
  },
  shutdown: async () => {
    if (boss) {
      await boss.stop();
      boss = null;
      logger.info('PgBoss stopped');
    }
  },
};
