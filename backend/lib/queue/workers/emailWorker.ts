import { PgBoss, Job } from 'pg-boss';
import { sendEmail } from '@lib/utils/email';
import { logger } from '@lib/utils/log';
import type { EmailJobData } from '../pgBoss';

export async function registerEmailWorkers(boss: PgBoss): Promise<void> {
  await boss.work('email-send', async (jobs: Job<EmailJobData>[]) => {
    for (const job of jobs) {
      await handleEmailJob(job);
    }
  });

  logger.info('Email workers registered');
}

async function handleEmailJob(job: Job<EmailJobData>): Promise<void> {
  const { to, subject, html, text } = job.data;

  try {
    await sendEmail({ to, subject, html, text });
    logger.info(`Successfully sent email to ${to}: ${subject}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error processing email job to ${to}: ${errorMessage}`);
    throw error; // Re-throw to trigger pg-boss retry
  }
}
