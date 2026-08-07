import '@config/boot';
import { logger } from '@config/log';
import { AppDataSource } from '@config/database';
import { Segment } from '@app/models';
import { parseSegments } from '@app/services/shirabe/parseSegments';

/**
 * Re-tokenise the segment corpus through Shirabe, filling `Segment.tokens`.
 *
 * A full pass is ~1.3M segments and takes hours, so this is built to be stopped
 * and resumed rather than run to completion in one go: `--after <id>` picks up
 * where a previous run left off.
 *
 * Pages are written whole, in id order, before the cursor advances. That is what
 * makes the resume point trustworthy -- everything at or below the last reported
 * id is durably written, so `--after` never leaves a gap behind it. Note this
 * holds at the *page* level only: `parseSegments` parallelises internally, but it
 * returns results in order and this loop awaits the write before moving on.
 *
 * A page is deliberately larger than `PARSE_BATCH`: parseSegments splits a page
 * into batches and runs several concurrently, so a page smaller than
 * PARSE_BATCH x SHIRABE_PARSE_CONCURRENCY would leave that concurrency unused.
 */
const PAGE_SIZE = Math.max(1, Number(process.env.REPARSE_PAGE_SIZE ?? 1000) || 1000);

/**
 * Segments per second to hold the job to, or 0 to run as fast as Shirabe allows.
 *
 * Concurrency alone is a poor throttle: at concurrency 1 this still drove Shirabe
 * to ~96/s and walked its workers up to ~2.1GB each, because Ruby heap growth
 * tracks total requests served rather than how many arrive at once. Pacing bounds
 * the request *rate*, which is the thing both CPU headroom for readers and that
 * heap growth actually follow.
 *
 * Applied by sleeping off whatever is left of a page's time budget, so a page
 * that was slow for its own reasons is never made slower.
 */
const TARGET_RATE = Math.max(0, Number(process.env.REPARSE_TARGET_RATE ?? 0) || 0);

/**
 * Shirabe restarts mid-run: a deploy drains and replaces the container, and the
 * in-flight request dies with ECONNRESET. An earlier run of this migration lost
 * ~440k segments of progress to exactly that, so a transient network failure
 * retries rather than ending the job. Non-transient failures (a 4xx, a missing
 * API key) still throw -- retrying those would just spin.
 */
const MAX_ATTEMPTS = 5;

function isTransient(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } })?.cause;
  const code = cause?.code ?? (error as { code?: string })?.code;

  return (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'UND_ERR_SOCKET' ||
    /\b(502|503|504)\b/.test(String((error as Error)?.message ?? ''))
  );
}

async function parseWithRetry(texts: string[]): Promise<Awaited<ReturnType<typeof parseSegments>>> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await parseSegments(texts);
    } catch (error) {
      lastError = error;
      if (!isTransient(error)) throw error;

      // Backs off so a Shirabe container swap (drain + boot, tens of seconds)
      // is ridden out rather than burning all the attempts in a few seconds.
      const delayMs = Math.min(30_000, 2_000 * 2 ** (attempt - 1));
      logger.warn({ err: error, attempt, delayMs }, 'Shirabe parse failed, retrying');
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

function parseArgs(): { after: number } {
  const args = process.argv.slice(2);
  let after = 0;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--after') {
      after = Number(args[i + 1]);
      if (!Number.isFinite(after)) {
        throw new Error(`--after expects a number, got: ${args[i + 1]}`);
      }
      i++;
    }
  }

  return { after };
}

async function main(): Promise<void> {
  const { after } = parseArgs();

  await AppDataSource.initialize();

  const repository = AppDataSource.getRepository(Segment);
  const total = await repository.count();

  logger.info({ after, total, pageSize: PAGE_SIZE }, 'reparse starting');

  let cursor = after;
  let written = 0;
  const startedAt = Date.now();

  for (;;) {
    const rows: Array<{ id: number; uuid: string; content: string }> = await AppDataSource.query(
      `SELECT id, uuid, content
         FROM "Segment"
        WHERE id > $1
        ORDER BY id
        LIMIT $2`,
      [cursor, PAGE_SIZE],
    );

    if (rows.length === 0) break;

    const pageStartedAt = Date.now();
    const tokens = await parseWithRetry(rows.map((row) => row.content));

    await AppDataSource.query(
      `UPDATE "Segment" AS s
          SET tokens = incoming.payload::jsonb
         FROM (SELECT unnest($1::text[]) AS uuid, unnest($2::text[]) AS payload) AS incoming
        WHERE s.uuid = incoming.uuid`,
      [rows.map((row) => row.uuid), tokens.map((token) => JSON.stringify(token))],
    );

    cursor = rows[rows.length - 1]!.id;
    written += rows.length;

    const rate = Math.round(written / Math.max(1, (Date.now() - startedAt) / 1000));
    logger.info({ written, total, rate, lastId: cursor }, 'reparse progress');

    if (TARGET_RATE > 0) {
      const budgetMs = (rows.length / TARGET_RATE) * 1000;
      const spentMs = Date.now() - pageStartedAt;
      if (spentMs < budgetMs) {
        await new Promise((resolve) => setTimeout(resolve, budgetMs - spentMs));
      }
    }
  }

  logger.info({ written, lastId: cursor }, 'reparse finished');
}

main()
  .then(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error({ err: error }, 'reparse failed');
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    process.exit(1);
  });
