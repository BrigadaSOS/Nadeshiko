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
      logger.info(`Enqueued email job ${jobId} with dedupe key ${dedupeKey} to ${data.to}`);
    } else {
      jobId = await boss.send(EMAIL_SEND_QUEUE, data);
      logger.info(`Enqueued email job ${jobId} to ${data.to}`);
    }

    return jobId;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to enqueue email job: ${errorMessage}`);
    return null;
  }
}
