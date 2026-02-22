import { vi } from 'bun:test';
import * as pgBossModule from '@app/workers/pgBoss';
import { createSegmentInES, updateSegmentInES, deleteSegmentFromES } from '@app/services/elasticsearchSync';
import { sendEmail } from '@app/mailers/email';
import { Segment } from '@app/models';
import type { EsSyncJobData, EmailJobData } from '@app/workers/pgBoss';

/**
 * Job test helpers — Nadeshiko's equivalent of Rails' perform_enqueued_jobs.
 *
 * pg-boss is never initialized in the test environment, so jobs sent during
 * normal integration tests are silently dropped (the subscriber swallows the
 * error from getPgBoss()). That's correct for most tests.
 *
 * Use performEnqueuedJobs() when a test needs async side-effects to actually
 * happen (ES indexing, email sending) before asserting on the result.
 *
 * Works by spying on sendEsSyncJob/sendEmailJob to capture calls during the
 * block, then executing the handler logic inline (synchronously from the
 * test's perspective) after the block completes.
 *
 * @example
 * it('indexes the segment in ES after creation', async () => {
 *   await performEnqueuedJobs(async () => {
 *     await Segment.save({ contentJa: '猫が好き', ... });
 *   });
 *   // ES sync ran inline — assert against the search index.
 *   const res = await request(app).get('/v1/search?q=猫');
 *   expect(res.body.results).toHaveLength(1);
 * });
 */
export async function performEnqueuedJobs(block: () => Promise<void>): Promise<void> {
  const esSyncJobs: EsSyncJobData[] = [];
  const emailJobs: EmailJobData[] = [];

  const esSpy = vi.spyOn(pgBossModule, 'sendEsSyncJob').mockImplementation(async (data) => {
    esSyncJobs.push(data);
    return 'mock-job-id';
  });

  const emailSpy = vi.spyOn(pgBossModule, 'sendEmailJob').mockImplementation(async (data, _dedupeKey) => {
    emailJobs.push(data);
    return 'mock-job-id';
  });

  try {
    await block();
  } finally {
    esSpy.mockRestore();
    emailSpy.mockRestore();
  }

  for (const job of esSyncJobs) {
    if (job.operation === 'CREATE') {
      const segment = await Segment.findOne({ where: { id: job.segmentId } });
      if (segment) await createSegmentInES(segment);
    } else if (job.operation === 'UPDATE') {
      const segment = await Segment.findOne({ where: { id: job.segmentId } });
      if (segment) await updateSegmentInES(segment);
    } else if (job.operation === 'DELETE') {
      await deleteSegmentFromES(job.segmentId);
    }
  }

  for (const job of emailJobs) {
    await sendEmail(job);
  }
}
