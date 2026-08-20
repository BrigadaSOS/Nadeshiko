import { PgBoss, Job } from 'pg-boss';
import { logger } from '@config/log';
import { deleteProviderSuppression } from '@app/services/email/zeptomailApi';
import { EMAIL_SUPPRESSION_LIFT_QUEUE } from './queueNames';
import { instrumentedHandler } from './workerInstrumentation';

export interface SuppressionLiftJobData {
  address: string;
}

/**
 * Tell ZeptoMail we have forgiven an address, after our own row has gone.
 *
 * A job rather than an inline call: it is a network round trip to two hosts
 * (Zoho's accounts endpoint, then the API), and a timeout must not roll back a
 * lift we have already made locally.
 */
export async function registerEmailSuppressionLiftWorkers(boss: PgBoss): Promise<void> {
  await boss.work(
    EMAIL_SUPPRESSION_LIFT_QUEUE,
    instrumentedHandler(EMAIL_SUPPRESSION_LIFT_QUEUE, async (jobs: Job<SuppressionLiftJobData>[]) => {
      for (const job of jobs) {
        const lifted = await deleteProviderSuppression(job.data.address);
        if (!lifted) {
          // NOT re-thrown. The provider half failing is a real condition an
          // operator has to act on, but it is not transient, so burning three
          // retries on it would only delay the log line that says so.
          logger.warn("Our suppression row is gone but the address is still on ZeptoMail's list");
        }
      }
    }),
  );

  logger.info('Email suppression lift workers registered');
}

export async function enqueueSuppressionLift(boss: PgBoss, address: string): Promise<string | null> {
  return boss.send(EMAIL_SUPPRESSION_LIFT_QUEUE, { address }, { singletonKey: `lift-${address}` });
}
