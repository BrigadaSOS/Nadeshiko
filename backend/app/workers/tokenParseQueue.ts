import { logger } from '@config/log';
import { getPgBoss } from './pgBossClient';
import { TOKEN_PARSE_QUEUE } from './queueNames';

export interface TokenParseJobData {
  segmentId: number;
}

/**
 * Ask for a segment's Japanese to be run through Shirabe.
 *
 * One job per segment rather than a job carrying a list, which is the same shape
 * the ES sync queue uses and for the same reason: the worker pulls a batch and
 * turns it into one Shirabe request, so batching is the consumer's decision, not
 * the producer's. A producer that chose the batch size would have to know what
 * `PARSE_BATCH` is, and an episode arriving as 312 lines would be parsed in
 * whatever chunks the upload happened to arrive in.
 *
 * Failing to enqueue is logged and swallowed, not thrown. The caller is an
 * ingest or an edit that has already committed its rows, and a segment with no
 * tokens is a degraded reader experience -- plain highlight HTML, no word cards
 * -- rather than a broken one. The nightly sweep (`TOKEN_SWEEP_QUEUE`) is what
 * makes that recoverable without the write path having to care.
 */
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

/**
 * The batch form, for an episode landing at once.
 *
 * `insert` and not `send`: `send(queue, jobs)` stores the whole array as one
 * job's payload, and this worker reads a pull as one job per segment. See the
 * note on `sendBulkEsSyncJobs`, which learned this the expensive way.
 */
/**
 * Rows per `insert` call.
 *
 * pg-boss builds ONE statement per call -- it does not chunk internally -- so
 * the batch size here is the size of the statement. An episode (a few thousand)
 * is the same order as what `sendBulkEsSyncJobs` already sends in production, but
 * the nightly sweep can offer twenty thousand at once, and a single INSERT
 * carrying that much JSON is a shape nothing here has ever run.
 */
const INSERT_CHUNK = 2_000;

export async function sendBulkTokenParseJobs(segmentIds: number[]): Promise<void> {
  if (segmentIds.length === 0) return;

  try {
    const boss = getPgBoss();

    for (let offset = 0; offset < segmentIds.length; offset += INSERT_CHUNK) {
      const chunk = segmentIds.slice(offset, offset + INSERT_CHUNK);
      await boss.insert(
        TOKEN_PARSE_QUEUE,
        // The same singleton key `sendTokenParseJob` debounces on, so the two
        // producers collapse onto one queued job per segment instead of parsing
        // the sentence twice. Re-uploading an episode over itself is the case
        // that makes this worth writing down: the upsert enqueues every line
        // again while the first pass may still be waiting.
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
