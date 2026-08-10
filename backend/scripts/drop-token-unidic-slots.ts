/**
 * Strips `p1`, `p2`, `p4` and `cf` out of every stored token.
 *
 * They were never a naming scheme. They are UniDic array indices wearing them as
 * names -- pos[1], pos[2], pos[4] -- which is why there is no `p3` and why pos[5]
 * is called `cf` instead of `p5`: Sudachi's internal shape, from when this repo
 * ran Sudachi itself, leaking into a contract we published. Nothing read them.
 * `posLabel` says what they were kept to say, in words, and needs no UniDic table
 * at the far end. They cost ~11.9% of a 1069 MB column, against 57 MB of the
 * sentences they annotate.
 *
 * A SCRIPT AND NOT A MIGRATION, which was the first draft and was wrong twice.
 *
 * There is no schema change here at all: `tokens` is jsonb and these are keys
 * inside it, so there is nothing for a migration to alter. And TypeORM runs a
 * migration inside one transaction, so batching within it buys nothing -- the
 * locks and the WAL are held for the whole corpus either way, and an interrupted
 * deploy rolls back every batch. The first attempt at this proved it: killed
 * after ten minutes, it reverted all 1.25M rows and left 1.7 GB of dead tuples
 * behind (4303 MB -> 5984 MB).
 *
 * So each batch here is its own statement, committed on its own. Interrupt it
 * and the rows already done stay done.
 *
 * SAFE TO INTERRUPT, AND SAFE TO RE-RUN. The WHERE clause selects only rows that
 * still carry one of the keys, so a second run resumes where the first stopped
 * and a finished corpus is a no-op. Nothing here touches `content` or any offset
 * -- it removes keys from objects, so every `b`/`e` still points where it did.
 * That is the difference from the wakati repair, which moved characters and
 * therefore had to invalidate the tokens in the same statement.
 *
 * RUN A VACUUM AFTER. Rewriting 1.25M jsonb rows leaves the old versions behind
 * as dead tuples; autovacuum will get there, but on a column this size it is
 * worth not waiting.
 *
 * Elasticsearch holds its own copy of the tokens, so a reindex is what makes this
 * visible to readers -- `scripts/reindex-media.ts` per media, or `bin/es.ts
 * reindex` for the corpus. Nothing breaks in the meantime: an ES document
 * carrying four dead keys renders exactly like one without them.
 *
 * Usage:
 *   node --import tsx scripts/drop-token-unidic-slots.ts --dry-run
 *   node --import tsx scripts/drop-token-unidic-slots.ts
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppDataSource } from '@config/database';

const BATCH = 5000;
const REPORT_EVERY_MS = 5000;

// Cheap prefilter. `tokens::text LIKE` beats unnesting the array to ask the same
// question, and this runs against every row on every batch.
const CARRIES_A_SLOT = `(tokens::text LIKE '%"p1":%' OR tokens::text LIKE '%"p2":%'
                      OR tokens::text LIKE '%"p4":%' OR tokens::text LIKE '%"cf":%')`;

async function remaining(): Promise<number> {
  const [row] = (await AppDataSource.query(
    `SELECT count(*)::int AS n FROM "Segment" WHERE tokens IS NOT NULL AND ${CARRIES_A_SLOT}`,
  )) as [{ n: number }];
  return row.n;
}

async function run(dryRun: boolean): Promise<void> {
  const total = await remaining();
  console.error(`${total} segments still carry a UniDic slot`);
  if (dryRun) {
    console.error('dry run: nothing was written');
    return;
  }

  const startedAt = Date.now();
  let done = 0;
  let reportedAt = 0;

  for (;;) {
    // One statement, one transaction, one batch. `ORDER BY ordinality` because
    // jsonb_agg over a set has no inherent order and these are positional
    // tokens -- reordering them would scramble every offset in the sentence.
    const rows = (await AppDataSource.query(
      `WITH target AS (
         SELECT id FROM "Segment"
          WHERE tokens IS NOT NULL AND ${CARRIES_A_SLOT}
          LIMIT $1
       )
       UPDATE "Segment" s
          SET tokens = (
                SELECT jsonb_agg(t - 'p1' - 'p2' - 'p4' - 'cf' ORDER BY ordinality)
                  FROM jsonb_array_elements(s.tokens) WITH ORDINALITY AS e(t, ordinality)
              )
         FROM target
        WHERE s.id = target.id
        RETURNING s.id`,
      [BATCH],
    )) as unknown[];

    if (rows.length === 0) break;
    done += rows.length;

    const elapsed = Date.now() - startedAt;
    if (elapsed - reportedAt >= REPORT_EVERY_MS) {
      reportedAt = elapsed;
      const rate = Math.round((done / elapsed) * 1000);
      process.stderr.write(`\r${done}/${total} rewritten, ${rate}/s   `);
    }
  }

  console.error(`\nrewrote ${done} segments`);
  console.error('now: VACUUM "Segment", then reindex Elasticsearch');
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    await run(process.argv.includes('--dry-run'));
  } finally {
    await AppDataSource.destroy();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
