import { PgBoss, Job } from 'pg-boss';
import { In } from 'typeorm';
import { Segment, SegmentStatus } from '@app/models';
import { parseSegments } from '@app/services/shirabe/parseSegments';
import { logger } from '@config/log';
import { sendBulkEsSyncJobs } from './esSyncQueue';
import { sendBulkTokenParseJobs, type TokenParseJobData } from './tokenParseQueue';
import { TOKEN_PARSE_QUEUE, TOKEN_SWEEP_QUEUE } from './queueNames';
import { instrumentedHandler } from './workerInstrumentation';

/** Pull enough to fill the parser’s internal concurrent batches without making one retry redo an unnecessarily large
 * pull. */
const PULL_SIZE = 500;

/** Cap nightly recovery work so a missed write path cannot launch a corpus-sized parse against a live reader
 * service; the rest waits for tomorrow. */
const SWEEP_LIMIT = 20_000;

export async function registerTokenParseWorker(boss: PgBoss): Promise<void> {
  await boss.work(
    TOKEN_PARSE_QUEUE,
    // Use one pg-boss worker team because `parseSegments` already controls internal parallelism and latency backoff.
    { batchSize: PULL_SIZE, teamSize: 1 },
    instrumentedHandler(TOKEN_PARSE_QUEUE, handleTokenParse),
  );

  await boss.work(
    TOKEN_SWEEP_QUEUE,
    instrumentedHandler(TOKEN_SWEEP_QUEUE, async (_jobs: Job[]) => {
      await handleTokenSweep();
    }),
  );

  logger.info({ pullSize: PULL_SIZE }, 'Token parse worker registered');
}

async function handleTokenParse(jobs: Job<TokenParseJobData>[]): Promise<void> {
  const segmentIds = jobs.map((job) => job.data.segmentId);

  const segments = await Segment.find({
    where: { id: In(segmentIds) },
    select: { id: true, uuid: true, contentJa: true },
    order: { id: 'ASC' },
  });

  const missing = segmentIds.length - segments.length;
  if (missing > 0) {
    // Ordinary: a segment can be hard-deleted between the enqueue and the pull.
    logger.info({ missing, asked: segmentIds.length }, 'Some segments to parse no longer exist');
  }
  if (segments.length === 0) return;

  const texts = segments.map((segment) => segment.contentJa ?? '');
  const tokenLists = await parseSegments(texts);

  // Guard the update by both id and current text so stale analysis cannot overwrite an edit; use a CTE/SELECT because
  // TypeORM raw UPDATE RETURNING has a different result shape.
  const updated: Array<{ id: number }> = await Segment.getRepository().query(
    `WITH incoming AS (
       SELECT unnest($1::text[]) AS uuid,
              unnest($2::text[]) AS text,
              unnest($3::text[]) AS payload
     ), updated AS (
       UPDATE "Segment" AS s
          SET tokens = incoming.payload::jsonb
         FROM incoming
        WHERE s.uuid = incoming.uuid
          AND s.content = incoming.text
        RETURNING s.id
     )
     SELECT id FROM updated`,
    [segments.map((segment) => segment.uuid), texts, tokenLists.map((tokens) => JSON.stringify(tokens))],
  );

  const empty = tokenLists.filter((tokens) => tokens.length === 0).length;
  logger.info({ asked: segmentIds.length, written: updated.length, empty }, 'Parsed segment tokens');

  // Raw SQL bypasses TypeORM subscribers, so enqueue ES sync explicitly for rows actually updated; skipped rows already
  // have their own work.
  if (updated.length > 0) {
    await sendBulkEsSyncJobs(updated.map((row) => ({ segmentId: row.id, operation: 'UPDATE' as const })));
  }
}

/** Nightly parsing repairs rows missed by writes, restores, or failed enqueueing; skip deleted segments because they
 * are neither served nor indexed. */
async function handleTokenSweep(): Promise<void> {
  const rows: Array<{ id: number }> = await Segment.getRepository().query(
    `SELECT id FROM "Segment"
      WHERE tokens IS NULL AND status <> $1::segment_status
      ORDER BY id
      LIMIT $2`,
    [SegmentStatus.DELETED, SWEEP_LIMIT + 1],
  );

  if (rows.length === 0) {
    logger.info('Token sweep found nothing to parse');
    return;
  }

  const overflowed = rows.length > SWEEP_LIMIT;
  const batch = overflowed ? rows.slice(0, SWEEP_LIMIT) : rows;

  await sendBulkTokenParseJobs(batch.map((row) => row.id));

  if (overflowed) {
    logger.warn(
      { enqueued: batch.length, limit: SWEEP_LIMIT },
      'Token sweep hit its cap; more segments are still untokenized and will wait for tomorrow',
    );
  } else {
    logger.info({ enqueued: batch.length }, 'Token sweep enqueued untokenized segments');
  }
}
