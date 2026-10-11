/** Removes obsolete token keys from JSONB in committed batches rather than a migration; it is resumable/idempotent,
 * preserves offsets/content, needs VACUUM afterward, and requires Elasticsearch reindexing. Usage: `node --import
 * tsx scripts/drop-dead-token-fields.ts [--dry-run|--after <id>]`. */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppDataSource } from '@config/database';

const BATCH = 5000;
const REPORT_EVERY_MS = 5000;

// Cheap prefilter. `tokens::text LIKE` beats unnesting the array to ask the same
// question, and this runs against every row on every batch.
const DEAD_FIELDS = ['wid', 'p1', 'p2', 'p4', 'cf'] as const;

const CARRIES_A_DEAD_FIELD = `(${DEAD_FIELDS.map((f) => `tokens::text LIKE '%"${f}":%'`).join(' OR ')})`;
const STRIP = DEAD_FIELDS.map((f) => `- '${f}'`).join(' ');

async function remaining(): Promise<number> {
  const [row] = (await AppDataSource.query(
    `SELECT count(*)::int AS n FROM "Segment" WHERE tokens IS NOT NULL AND ${CARRIES_A_DEAD_FIELD}`,
  )) as [{ n: number }];
  return row.n;
}

async function run(dryRun: boolean, after: number): Promise<void> {
  const total = await remaining();
  console.error(`${total} segments still carry one of: ${DEAD_FIELDS.join(', ')}`);
  if (dryRun) {
    console.error('dry run: nothing was written');
    return;
  }

  const startedAt = Date.now();
  let cursor = after;
  let done = 0;
  let reportedAt = 0;

  for (;;) {
    // Walk by primary key so the unindexed JSONB predicate scans once; `--after` keeps the run resumable instead of
    // rescanning from the beginning each batch.
    const rows = (await AppDataSource.query(
      `WITH target AS (
         SELECT id FROM "Segment"
          WHERE id > $1 AND tokens IS NOT NULL
          ORDER BY id
          LIMIT $2
       ), rewritten AS (
         UPDATE "Segment" s
            SET tokens = (
                  SELECT jsonb_agg(t ${STRIP} ORDER BY ordinality)
                    FROM jsonb_array_elements(s.tokens) WITH ORDINALITY AS e(t, ordinality)
                )
           FROM target
          WHERE s.id = target.id AND ${CARRIES_A_DEAD_FIELD}
          RETURNING s.id
       )
       SELECT (SELECT max(id) FROM target) AS cursor,
              (SELECT count(*)::int FROM target) AS seen,
              (SELECT count(*)::int FROM rewritten) AS changed`,
      [cursor, BATCH],
    )) as [{ cursor: number | null; seen: number; changed: number }];

    const page = rows[0];
    if (!page || page.seen === 0 || page.cursor === null) break;
    cursor = page.cursor;
    done += page.changed;

    const elapsed = Date.now() - startedAt;
    if (elapsed - reportedAt >= REPORT_EVERY_MS) {
      reportedAt = elapsed;
      const rate = Math.round((done / elapsed) * 1000);
      process.stderr.write(`\r${done}/${total} rewritten, ${rate}/s, last id ${cursor}   `);
    }
  }

  console.error(`\nrewrote ${done} segments`);
  console.error('now: VACUUM "Segment", then reindex Elasticsearch');
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const index = process.argv.indexOf('--after');
    const after = index === -1 ? 0 : Number(process.argv[index + 1]) || 0;
    await run(process.argv.includes('--dry-run'), after);
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
