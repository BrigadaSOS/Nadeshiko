import { vi } from 'vitest';
import * as emailQueueModule from '@app/workers/emailQueue';
import * as esSyncQueueModule from '@app/workers/esSyncQueue';
import { sendEmail } from '@app/mailers/email';
import { Segment } from '@app/models';
import { SegmentIndexer } from '@app/services/search/segmentDocument/SegmentIndexer';
import type { EmailJobData } from '@app/workers/emailQueue';
import type { EsSyncJobData } from '@app/workers/esSyncQueue';

/** Test helper for running queued side effects inline. pg-boss is unavailable in tests, so use `performEnqueuedJobs`
 * when assertions need ES indexing or email handling before they run. It captures sends during the block and
 * invokes the handlers afterward. */
export async function performEnqueuedJobs(block: () => Promise<void>): Promise<void> {
  const esSyncJobs: EsSyncJobData[] = [];
  const emailJobs: EmailJobData[] = [];

  const esSpy = vi.spyOn(esSyncQueueModule, 'sendEsSyncJob').mockImplementation(async (data) => {
    esSyncJobs.push(data);
    return 'mock-job-id';
  });

  const emailSpy = vi.spyOn(emailQueueModule, 'sendEmailJob').mockImplementation(async (data, _dedupeKey) => {
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
      if (segment) await SegmentIndexer.index(segment);
    } else if (job.operation === 'UPDATE') {
      const segment = await Segment.findOne({ where: { id: job.segmentId } });
      if (segment) await SegmentIndexer.index(segment);
    } else if (job.operation === 'DELETE') {
      await SegmentIndexer.delete(job.segmentId);
    }
  }

  for (const job of emailJobs) {
    // Same fallback the real worker uses: `kind` is optional on the job so a
    // rollout does not strand jobs enqueued by the previous deploy.
    await sendEmail({ ...job, kind: job.kind ?? 'unknown' });
  }
}
