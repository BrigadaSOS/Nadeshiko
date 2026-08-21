import { PgBoss, Job } from 'pg-boss';
import { In } from 'typeorm';
import { Segment, SegmentStatus } from '@app/models';
import { parseSegments } from '@app/services/shirabe/parseSegments';
import { logger } from '@config/log';
import { sendBulkEsSyncJobs } from './esSyncQueue';
import { sendBulkTokenParseJobs, type TokenParseJobData } from './tokenParseQueue';
import { TOKEN_PARSE_QUEUE, TOKEN_SWEEP_QUEUE } from './queueNames';
import { instrumentedHandler } from './workerInstrumentation';

/**
 * How many segments one pull turns into.
 *
 * Mirrors the page size the corpus script uses, and for the same reason:
 * `parseSegments` splits its input into batches of `PARSE_BATCH` (200) and runs
 * `SHIRABE_PARSE_CONCURRENCY` (3) of them at once, so a pull smaller than
 * batch x concurrency leaves that concurrency idle. 500 fills it without being
 * so large that one bad chunk retries a pointless amount of work.
 */
const PULL_SIZE = 500;

/**
 * Ceiling on what one nightly sweep will enqueue.
 *
 * The sweep exists to catch rows the write path missed, which should be a
 * handful. A corpus-sized hole -- a restored dump, a backfill that went round
 * the API -- is not something to discover by pointing 1.3M parses at a server
 * other people are reading from at 06:00. Past the cap the sweep enqueues what
 * it can, says how much it left, and picks the rest up tomorrow; the operator
 * who wants it done now has `scripts/parse-corpus-with-shirabe.ts`, which is
 * pausable and resumable and was built for exactly that.
 */
const SWEEP_LIMIT = 20_000;

export async function registerTokenParseWorker(boss: PgBoss): Promise<void> {
  await boss.work(
    TOKEN_PARSE_QUEUE,
    // teamSize 1 on purpose. `parseSegments` already parallelises internally and
    // watches its own latency to back off when Shirabe slows; a team of workers
    // would put that limiter's decisions in competition with itself.
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

  // One statement for the pull. Matched on uuid AND on the text we parsed: an
  // edit that lands between the read above and this write changes `content`, and
  // without that second condition we would overwrite the new sentence's tokens
  // with an analysis of the old one -- silently, and with `b`/`e` offsets that
  // index into a string nobody is holding any more. Losing the write is right:
  // the edit enqueued its own parse on the way past.
  // The RETURNING is read through a CTE and a plain SELECT because TypeORM hands
  // back `[rows, affectedCount]` for a bare UPDATE ... RETURNING and `rows` for a
  // SELECT. Taking `.length` of the former counts 2 whatever happened, which is
  // a number that looks like a row count and never is.
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

  // The UPDATE above is a raw statement, so no TypeORM subscriber fires and
  // nothing reindexes on its own -- the same trap `parse-corpus-with-shirabe.ts`
  // answers with a separate `reindex-media.ts` run. Here the sync is enqueued
  // outright, which is what makes this path complete where the script's is two
  // commands. Only the rows that actually changed: the ones the text guard
  // skipped are already queued by whoever changed them.
  if (updated.length > 0) {
    await sendBulkEsSyncJobs(updated.map((row) => ({ segmentId: row.id, operation: 'UPDATE' as const })));
  }
}

/**
 * The nightly backstop: anything with no tokens gets queued for a parse.
 *
 * The write paths enqueue their own work, so on a healthy day this finds
 * nothing. What it covers is everything that does not go through them -- a
 * restored backup, a direct SQL insert, an enqueue that failed while pg-boss was
 * down -- and the case that actually happened: a corpus whose only tokenizer was
 * a script somebody had to remember to run.
 *
 * DELETED segments are skipped. They are not served and not indexed, so parsing
 * them spends Shirabe's CPU on text no reader can reach; if one is restored, the
 * restore is an update and enqueues its own parse.
 */
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
