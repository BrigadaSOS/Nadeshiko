import { PgBoss, Job } from 'pg-boss';
import { logger } from '@config/log';
import type { MorphemeJobData } from '@app/workers/pgBoss';

export async function registerMorphemeWorkers(boss: PgBoss): Promise<void> {
  const workerOptions = {
    batchSize: 10,
    teamSize: 2,
  };

  await boss.work('morpheme-analyze', workerOptions, async (jobs: Job<MorphemeJobData>[]) => {
    for (const job of jobs) {
      await handleMorphemeJob(job);
    }
  });

  logger.info('Morpheme workers registered with batchSize=10, teamSize=2');
}

async function handleMorphemeJob(job: Job<MorphemeJobData>): Promise<void> {
  const { segmentId } = job.data;

  // TEMPORARILY DISABLED - lindera.js dependency removed
  logger.warn(`Morpheme analysis temporarily disabled for segment ${segmentId} - lindera.js dependency removed`);
  return;

  // try {
  //   const segment = await Segment.findOne({ where: { id: segmentId } });
  //   if (!segment) {
  //     logger.warn(`Segment ${segmentId} not found for morpheme analysis, skipping`);
  //     return;
  //   }
  //
  //   const morphemes = analyze(segment.contentJa);
  //
  //   // Use createQueryBuilder to bypass the subscriber (avoid infinite loop)
  //   await AppDataSource.createQueryBuilder()
  //     .update(Segment)
  //     .set({ morphemes })
  //     .where('id = :id', { id: segmentId })
  //     .execute();
  //
  //   logger.info(`Morphemes saved for segment ${segmentId}`);
  //
  //   // Now enqueue ES sync to push the updated segment (with morphemes) to ES
  //   await sendEsSyncJob({ segmentId, operation });
  // } catch (error) {
  //   logger.error({ err: error, segmentId }, 'Error processing morpheme job');
  //   throw error;
  // }
}
