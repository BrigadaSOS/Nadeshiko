import { logger } from '@config/log';
import { getPgBoss } from './pgBossClient';
import { EMAIL_SEND_QUEUE } from './queueNames';

export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
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
      logger.info({ jobId, dedupeKey, to: data.to }, 'Enqueued email job');
    } else {
      jobId = await boss.send(EMAIL_SEND_QUEUE, data);
      logger.info({ jobId, to: data.to }, 'Enqueued email job');
    }

    return jobId;
  } catch (error) {
    logger.error({ err: error }, 'Failed to enqueue email job');
    return null;
  }
}
