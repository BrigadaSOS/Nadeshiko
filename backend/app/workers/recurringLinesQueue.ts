import { logger } from '@config/log';
import { getPgBoss } from './pgBossClient';
import { RECURRING_RECOMPUTE_QUEUE, RECURRING_SWEEP_QUEUE } from './queueNames';

export interface RecurringRecomputeJobData {
  mediaId: number;
}

/**
 * Seconds a title's recompute waits for more writes. An episode upload arrives as several batches in quick
 * succession; one recompute after the last of them is enough, since it reads the whole title.
 */
const RECOMPUTE_DEBOUNCE_SECONDS = 30;

/** Queue a recompute of one title's recurring-line repeats. Failure is logged, not thrown: the nightly sweep is the
 * recovery path, and a content write must not fail over search bookkeeping. */
export async function sendRecurringRecomputeJob(mediaId: number): Promise<void> {
  try {
    await getPgBoss().sendDebounced(
      RECURRING_RECOMPUTE_QUEUE,
      { mediaId },
      null,
      RECOMPUTE_DEBOUNCE_SECONDS,
      `${mediaId}`,
    );
  } catch (error) {
    logger.error(
      { err: error, mediaId },
      'Failed to enqueue recurring-line recompute; the nightly sweep will repair it',
    );
  }
}

/** Queue a recompute for each of several titles, one job each. */
export async function sendRecurringRecomputeJobs(mediaIds: Iterable<number>): Promise<void> {
  for (const mediaId of new Set(mediaIds)) await sendRecurringRecomputeJob(mediaId);
}

/** Queue a sweep over every title. Collapsed onto one job per `windowSeconds`, so several backend boots in a row (a
 * deploy, a restart) start one sweep, not one each. */
export async function sendRecurringSweepJob(reason: string, windowSeconds = 600): Promise<void> {
  try {
    await getPgBoss().send(
      RECURRING_SWEEP_QUEUE,
      { reason },
      { singletonKey: 'sweep', singletonSeconds: windowSeconds },
    );
  } catch (error) {
    logger.error({ err: error, reason }, 'Failed to enqueue recurring-line sweep');
  }
}
