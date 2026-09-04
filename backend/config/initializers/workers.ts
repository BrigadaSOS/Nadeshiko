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
          // One retry, not five. This is a sweep over a query, so a second run
          // finds exactly what the first would have; the value of retrying is
          // covering a transient database blip, and beyond that a failure means
          // the query is wrong and repeating it just delays the log line saying
          // so. Nobody is waiting: the next run is tomorrow at 05:00 either way.
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
          // Shirabe is a small server that also serves readers, so a failure
          // here is usually "come back later" rather than "this will never
          // work": a restart mid-deploy, a 502, a slow chunk timing out. Backing
          // off across five attempts rides those out. `parseSegments` retries
          // the individual chunk first; this is the outer net for when the whole
          // pull dies.
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
          // A sweep over a query, so a retry finds what the first run would
          // have. Same reasoning as the email lifecycle sweep: one retry covers
          // a database blip, and past that the next run is tomorrow.
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

    // `createQueue` deliberately does not modify an existing queue. Apply the
    // corrected delay to the three ES queues explicitly, without touching
    // unrelated queue settings or their existing jobs.
    for (const queueName of [ES_SYNC_CREATE_QUEUE, ES_SYNC_UPDATE_QUEUE, ES_SYNC_DELETE_QUEUE]) {
      await boss.updateQueue(queueName, { retryDelay: 1 });
    }

    await boss.schedule(ACTIVITY_RETENTION_QUEUE, '0 3 * * *', {});
    // An hour after the activity sweep, so the two nightly deletes do not
    // contend for the same window.
    await boss.schedule(AFFINITY_RETENTION_QUEUE, '0 4 * * *', {});
    // An hour after the affinity sweep, which is what the recap will read. The
    // order matters on the 1st of the month: mailing a summary built from a
    // tally that has not finished rolling over would report the wrong month.
    await boss.schedule(EMAIL_LIFECYCLE_QUEUE, '0 5 * * *', {});
    // Last of the nightly jobs, and the only one that talks to another service.
    // It runs after the deletes so it never queues a parse for a row the
    // retention sweep is about to remove.
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
