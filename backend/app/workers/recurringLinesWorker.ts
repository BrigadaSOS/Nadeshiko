import type { Job, PgBoss } from 'pg-boss';
import { Media } from '@app/models';
import { recomputeRecurringRepeats } from '@app/services/search/recurringLines';
import { logger } from '@config/log';
import { sendBulkEsSyncJobs } from './esSyncQueue';
import { sendRecurringRecomputeJobs, type RecurringRecomputeJobData } from './recurringLinesQueue';
import { RECURRING_RECOMPUTE_QUEUE, RECURRING_SWEEP_QUEUE } from './queueNames';
import { instrumentedHandler } from './workerInstrumentation';

export async function registerRecurringLinesWorker(boss: PgBoss): Promise<void> {
  // One title at a time: each recompute is one statement over a title's segments, and the database also serves search.
  await boss.work(
    RECURRING_RECOMPUTE_QUEUE,
    { batchSize: 1 },
    instrumentedHandler(RECURRING_RECOMPUTE_QUEUE, async (jobs: Job<RecurringRecomputeJobData>[]) => {
      for (const job of jobs) await handleRecompute(job.data.mediaId);
    }),
  );

  await boss.work(
    RECURRING_SWEEP_QUEUE,
    instrumentedHandler(RECURRING_SWEEP_QUEUE, async (_jobs: Job[]) => {
      await handleSweep();
    }),
  );

  logger.info('Recurring-line workers registered');
}

/** Recompute one title and send the segments whose flag changed to the search index. */
async function handleRecompute(mediaId: number): Promise<void> {
  const changed = await recomputeRecurringRepeats(mediaId);
  if (changed.length === 0) return;

  const queued = await sendBulkEsSyncJobs(changed.map((segmentId) => ({ segmentId, operation: 'UPDATE' as const })));
  // The flags are saved but search would not see them; failing the job makes pg-boss run it again. A second run finds
  // nothing changed in Postgres, so the nightly sweep is what finally reconciles the index if every retry fails.
  if (!queued)
    throw new Error(`Could not enqueue the search update for ${changed.length} segment(s) of media ${mediaId}`);
}

/** Recompute every title. Runs nightly and at boot, so a lost recompute or a missed write path is repaired within a
 * day, and the first deploy of this feature fills the flags without a manual step. */
async function handleSweep(): Promise<void> {
  const media = await Media.find({ select: { id: true } });
  await sendRecurringRecomputeJobs(media.map((m) => m.id));
  logger.info({ titles: media.length }, 'Recurring-line sweep queued a recompute for every title');
}
