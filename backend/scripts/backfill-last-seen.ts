/**
 * Seeds `User.last_seen_at` for the accounts that predate it, out of the session
 * table.
 *
 * The column was added with no backfill (see the `remember-when-an-account-was-
 * last-seen` migration), so it is null for every account that has not signed in
 * or refreshed since it shipped -- which is exactly the population the dormant
 * win-back sweep exists to reach. Until this has run, `last_seen_at` is a column
 * about newcomers.
 *
 * WHY THE SESSION TABLE STILL HAS THE ANSWER, given sessions expire: nothing
 * sweeps it. Expired rows pile up, so `MAX(updated_at)` per user is a real
 * history of when accounts were last active, going back months. That is an
 * accident and a temporary one -- a session sweep is coming, and this has to run
 * BEFORE it, or the history is gone. Same deadline as
 * `backfill-session-country.ts`, and for the same reason.
 *
 * WHAT IT CANNOT RECOVER. A reader who signed out had their row deleted at that
 * moment, so there is nothing here to read and they stay null. That is the right
 * answer rather than a gap: `dormantCandidates` coalesces a null to `created_at`,
 * and an account whose only trace is its signup has, by the rule the sweep now
 * runs on, done nothing since. Backdating them to a guessed session would be
 * inventing a visit.
 *
 * ONLY WRITES NULLS. Rows where the live path has already recorded something are
 * never selected, so a session hook's answer always beats this one -- it is more
 * recent by construction. That also makes the script safe to re-run and safe to
 * interrupt: each batch commits on its own and a finished table is a no-op.
 *
 * Usage (locally; `--env-file-if-exists` supplies the database config):
 *   node --env-file-if-exists=.env --import tsx scripts/backfill-last-seen.ts --dry-run
 *   node --env-file-if-exists=.env --import tsx scripts/backfill-last-seen.ts
 *
 * Against production, through the wrapper every other remote write uses:
 *   scripts/remote-db.sh prod backfill-last-seen --allow-prod
 */

import { Pool } from 'pg';
import { config } from '@config/config';
import { logger } from '@config/log';

const BATCH_SIZE = 500;

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  const pool = new Pool({
    host: config.POSTGRES_HOST,
    port: config.POSTGRES_PORT,
    user: config.POSTGRES_USER,
    password: config.POSTGRES_PASSWORD,
    database: config.POSTGRES_DB,
  });

  const { rows: pending } = await pool.query<{ total: string; recoverable: string }>(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "session" s WHERE s.user_id = u.id)) AS recoverable
     FROM "User" u
     WHERE u.last_seen_at IS NULL`,
  );
  const total = Number(pending[0]?.total ?? 0);
  const recoverable = Number(pending[0]?.recoverable ?? 0);
  logger.info(
    `${total} accounts with no last_seen_at, ${recoverable} of them have session rows to read` +
      `${dryRun ? ' (dry run, nothing will be written)' : ''}`,
  );

  let seeded = 0;
  // Walks by id rather than re-selecting nulls, so a dry run terminates: with
  // nothing written the same rows would otherwise be selected forever.
  let cursor = 0;

  for (;;) {
    const { rows } = await pool.query<{ id: number; last_seen: Date }>(
      `SELECT u.id, (SELECT MAX(s.updated_at) FROM "session" s WHERE s.user_id = u.id) AS last_seen
       FROM "User" u
       WHERE u.last_seen_at IS NULL AND u.id > $1
       ORDER BY u.id
       LIMIT $2`,
      [cursor, BATCH_SIZE],
    );
    if (rows.length === 0) break;

    cursor = rows[rows.length - 1]?.id ?? cursor;

    const updates = rows.filter((row): row is { id: number; last_seen: Date } => row.last_seen !== null);

    if (updates.length > 0 && !dryRun) {
      await pool.query(
        `UPDATE "User" AS u SET last_seen_at = v.last_seen
         FROM (SELECT unnest($1::int[]) AS id, unnest($2::timestamptz[]) AS last_seen) AS v
         WHERE u.id = v.id AND u.last_seen_at IS NULL`,
        [updates.map((u) => u.id), updates.map((u) => u.last_seen)],
      );
    }

    seeded += updates.length;
    logger.info(`  ${seeded} seeded`);
  }

  logger.info(
    `${seeded} accounts seeded, ${total - seeded} left null (never signed in, or signed out and the row went with it)`,
  );

  await pool.end();
}

main().catch((error) => {
  logger.error({ err: error }, 'Backfill failed');
  process.exit(1);
});
