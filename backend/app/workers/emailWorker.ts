import { PgBoss, Job } from 'pg-boss';
import { sendEmail } from '@app/mailers/email';
import { logger } from '@config/log';
import type { EmailJobData } from './emailQueue';
import { EMAIL_SEND_QUEUE } from './queueNames';
import { instrumentedHandler } from './workerInstrumentation';

export async function registerEmailWorkers(boss: PgBoss): Promise<void> {
  await boss.work(
    EMAIL_SEND_QUEUE,
    instrumentedHandler(EMAIL_SEND_QUEUE, async (jobs: Job<EmailJobData>[]) => {
      for (const job of jobs) {
        await handleEmailJob(job);
      }
    }),
  );

  logger.info('Email workers registered');
}

async function handleEmailJob(job: Job<EmailJobData>): Promise<void> {
  const { to, subject, html } = job.data;

  try {
    await sendEmail({ to, subject, html });
    logger.info({ to, subject }, 'Email sent');
  } catch (error) {
    logger.error({ err: error, to, subject }, 'Error processing email job');
    throw error; // Re-throw to trigger pg-boss retry
  }
}
