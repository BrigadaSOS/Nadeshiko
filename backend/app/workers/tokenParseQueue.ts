import { logger } from '@config/log';
import { getPgBoss } from './pgBossClient';
import { TOKEN_PARSE_QUEUE } from './queueNames';

export interface TokenParseJobData {
  segmentId: number;
}

/** Enqueue one job per segment so the worker chooses parse batches; swallow enqueue failure because the nightly
 * sweep is the recovery path. */
export async function sendTokenParseJob(segmentId: number): Promise<string | null> {
  try {
    const boss = getPgBoss();
    // Debounced on the segment id: an edit that lands while a parse of the same
    // row is still queued should replace it, not queue a second identical parse.
    const jobId = await boss.sendDebounced(TOKEN_PARSE_QUEUE, { segmentId }, null, 1, `${segmentId}`);
    logger.info({ jobId, segmentId }, 'Enqueued token parse job');
    return jobId;
  } catch (error) {
    logger.error({ err: error, segmentId }, 'Failed to enqueue token parse job');
    return null;
  }
}

/** Use `insert`, not `send`, for an array: the worker consumes one job per segment and batches those jobs itself. */
/** Chunk pg-boss inserts because each call becomes one SQL statement; the chunk size bounds that statement for large
 * sweeps. */
const INSERT_CHUNK = 2_000;

export async function sendBulkTokenParseJobs(segmentIds: number[]): Promise<void> {
  if (segmentIds.length === 0) return;

  try {
    const boss = getPgBoss();

    for (let offset = 0; offset < segmentIds.length; offset += INSERT_CHUNK) {
      const chunk = segmentIds.slice(offset, offset + INSERT_CHUNK);
      await boss.insert(
        TOKEN_PARSE_QUEUE,
        // Use the segment id as the singleton key so upsert and insert producers collapse onto one parse job per
        // segment.
        chunk.map((segmentId) => ({ data: { segmentId }, singletonKey: `${segmentId}` })),
      );
    }

    logger.info({ count: segmentIds.length }, 'Enqueued bulk token parse jobs');
  } catch (error) {
    // A chunk that throws leaves the earlier ones enqueued, which is the right
    // partial state: those segments get parsed, and the sweep re-offers the rest.
    logger.error({ err: error, count: segmentIds.length }, 'Failed to enqueue bulk token parse jobs');
  }
}
