import { logger } from '@config/log';
import type { EmailKind } from '@app/services/email/metrics';
import { getPgBoss } from './pgBossClient';
import { EMAIL_SEND_QUEUE } from './queueNames';

export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  /**
   * Carried through the queue so a job that runs minutes later still knows which
   * message it is: the worker hands this to `sendEmail`, which turns it into the
   * `X-TM-CLIENT-REF` header and the `email.kind` metric label.
   *
   * Optional so a job enqueued by an older deploy still runs after a rollout
   * rather than failing on a field it never had.
   */
  kind?: EmailKind;
  /**
   * `List-Unsubscribe` target, carried through the queue so a job that runs
   * minutes later still offers the reader the way out. Optional for the same
   * reason `kind` is: a job enqueued by an older deploy has to keep working.
   */
  unsubscribeUrl?: string;
  /**
   * Which run of `kind` this is (`recap-2026-08`), for the lifecycle mail that
   * recurs. Rides out inside the client reference so a bounce three days later
   * names the send rather than only its shape.
   */
  campaign?: string;
}

/**
 * Send an email job with optional deduplication.
 * Uses sendDebounced when a dedupeKey is provided to prevent duplicate emails.
 */
export async function sendEmailJob(data: EmailJobData, dedupeKey?: string): Promise<string | null> {
  const boss = getPgBoss();

  try {
    let jobId: string | null;

    if (dedupeKey) {
      jobId = await boss.send(EMAIL_SEND_QUEUE, data, { singletonKey: dedupeKey });
      logger.info({ jobId, dedupeKey, 'email.kind': data.kind }, 'Enqueued email job');
    } else {
      jobId = await boss.send(EMAIL_SEND_QUEUE, data);
      logger.info({ jobId, 'email.kind': data.kind }, 'Enqueued email job');
    }

    return jobId;
  } catch (error) {
    logger.error({ err: error }, 'Failed to enqueue email job');
    return null;
  }
}
