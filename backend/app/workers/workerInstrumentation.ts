import type { Job, PgBoss } from 'pg-boss';
import { getTracer, getMeter } from '@config/telemetry';
import { recordError } from '@app/lib/errorFingerprint';
import { logger } from '@config/log';

const DURATION_BUCKETS = [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60];

const meter = getMeter();

const jobDuration = meter.createHistogram('pgboss.job.duration', {
  description: 'Duration of pg-boss job processing',
  unit: 's',
  advice: { explicitBucketBoundaries: DURATION_BUCKETS },
});

const jobCount = meter.createCounter('pgboss.job.count', {
  description: 'Number of pg-boss jobs processed',
  unit: '{job}',
});

export function registerQueueMetrics(boss: PgBoss, queueNames: readonly string[]): void {
  meter.createObservableGauge('pgboss.queue.size', {
    description: 'Number of jobs in each state per queue',
    unit: '{job}',
  }).addCallback(async (obs) => {
    for (const queue of queueNames) {
      try {
        const stats = await boss.getQueueStats(queue);
        obs.observe(stats.queuedCount, { 'pgboss.queue': queue, 'pgboss.state': 'queued' });
        obs.observe(stats.activeCount, { 'pgboss.queue': queue, 'pgboss.state': 'active' });
        obs.observe(stats.deferredCount, { 'pgboss.queue': queue, 'pgboss.state': 'deferred' });
      } catch (err) {
        logger.debug(`Failed to get queue stats for ${queue}: ${err}`);
      }
    }
  });

  const db = boss.getDb();
  meter.createObservableGauge('pgboss.queue.failed', {
    description: 'Number of failed jobs per queue',
    unit: '{job}',
  }).addCallback(async (obs) => {
    try {
      const result = await db.executeSql(
        `SELECT name, COUNT(*)::int AS count FROM pgboss.job WHERE state = 'failed' GROUP BY name`,
      );
      for (const row of result.rows) {
        obs.observe(row.count, { 'pgboss.queue': row.name });
      }
    } catch (err) {
      logger.debug(`Failed to get failed job counts: ${err}`);
    }
  });
}

export function instrumentedHandler<T>(
  queueName: string,
  handler: (jobs: Job<T>[]) => Promise<void>,
): (jobs: Job<T>[]) => Promise<void> {
  const tracer = getTracer();

  return async (jobs: Job<T>[]) => {
    return tracer.startActiveSpan(`pgboss.process ${queueName}`, async (span) => {
      span.setAttribute('messaging.system', 'pgboss');
      span.setAttribute('messaging.destination.name', queueName);
      span.setAttribute('messaging.batch.message_count', jobs.length);

      const startTime = performance.now();
      try {
        await handler(jobs);
        jobCount.add(jobs.length, { 'pgboss.queue': queueName, 'pgboss.status': 'completed' });
      } catch (error) {
        recordError(error instanceof Error ? error : new Error(String(error)), `worker:${queueName}`, {
          'pgboss.queue': queueName,
        });
        jobCount.add(jobs.length, { 'pgboss.queue': queueName, 'pgboss.status': 'failed' });
        throw error;
      } finally {
        const durationS = (performance.now() - startTime) / 1000;
        jobDuration.record(durationS, { 'pgboss.queue': queueName });
        span.end();
      }
    });
  };
}
