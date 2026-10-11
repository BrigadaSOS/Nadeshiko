import { logger } from '@config/log';
import type { EmailKind } from '@app/services/email/metrics';
import { getPgBoss } from './pgBossClient';
import { EMAIL_SEND_QUEUE } from './queueNames';

export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  /** Carry optional reader metadata for queued messages from mixed deployments; envelope identity is selected by
   * kind, not reader. */
  userId?: number;
  /** Carry the client reference through the queue for headers and metrics; keep it optional so jobs from older
   * deploys still run. */
  kind?: EmailKind;
  /** Carry the unsubscribe target through delayed jobs; optional preserves compatibility with jobs enqueued before
   * the field existed. */
  unsubscribeUrl?: string;
  /** Carry recurring campaign identity in the client reference so later bounces identify the run, not only the
   * message kind. */
  campaign?: string;
}

/** Enqueue an email job, using dedupeKey as the queue singleton key when provided. */
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
