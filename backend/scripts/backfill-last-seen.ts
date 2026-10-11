/** Backfills null `User.last_seen_at` from historical sessions before session cleanup. It writes only nulls, batches
 * independently, is safe to rerun/interruption, and supports `--dry-run`; production writes go through
 * `scripts/remote-db.sh ... --allow-prod`. */

// Load dotenv/boot before config so local values fill the schema while the remote wrapper overrides only Postgres
// settings.
import '@config/boot';
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
