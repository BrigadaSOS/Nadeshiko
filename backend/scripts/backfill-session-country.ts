/** Backfill only null countries using local GeoLite2 so reader IPs stay on the machine; countries written at sign-in
 * are preserved. Local runs need `--env-file-if-exists=.env`, `--db <path>` and initially `--dry-run`. Production:
 * `scripts/remote-db.sh prod backfill-session-country --allow-prod -- --db <path>`. */

import { readFileSync } from 'node:fs';
import { Reader } from 'mmdb-lib';
import type { CountryResponse } from 'mmdb-lib/lib/reader/response';
import { Pool } from 'pg';
import { config } from '@config/config';
import { logger } from '@config/log';

const BATCH_SIZE = 500;

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

/** Use the same two-letter/registered-country fallback shape as the live path so backfilled and new rows query
 * identically. */
function countryFor(reader: Reader<CountryResponse>, ip: string): string | null {
  let result: CountryResponse | null = null;
  try {
    result = reader.get(ip);
  } catch {
    // A malformed or private address. Not an error worth stopping for: it is
    // one row out of thousands and the column is nullable.
    return null;
  }

  const code = result?.country?.iso_code ?? result?.registered_country?.iso_code;
  if (!code || !/^[A-Z]{2}$/.test(code)) return null;

  return code;
}

async function main(): Promise<void> {
  const dbPath = argValue('--db');
  const dryRun = process.argv.includes('--dry-run');

  if (!dbPath) {
    logger.error('Pass the GeoLite2 country database with --db <path to GeoLite2-Country.mmdb>');
    process.exit(1);
  }

  let reader: Reader<CountryResponse>;
  try {
    reader = new Reader<CountryResponse>(readFileSync(dbPath));
  } catch (error) {
    logger.error({ err: error, dbPath }, 'Could not open the GeoLite2 database');
    process.exit(1);
  }

  const pool = new Pool({
    host: config.POSTGRES_HOST,
    port: config.POSTGRES_PORT,
    user: config.POSTGRES_USER,
    password: config.POSTGRES_PASSWORD,
    database: config.POSTGRES_DB,
  });

  const { rows: pending } = await pool.query<{ total: string }>(
    `SELECT count(*) AS total FROM session WHERE country IS NULL AND ip_address IS NOT NULL AND ip_address <> ''`,
  );
  logger.info(`${pending[0]?.total ?? 0} session rows to place${dryRun ? ' (dry run, nothing will be written)' : ''}`);

  const tally = new Map<string, number>();
  let placed = 0;
  let unplaceable = 0;

  // Dry-run rows remain null, so use ID walking there; real runs resume by selecting remaining nulls.
  let cursor = 0;

  for (;;) {
    const { rows } = await pool.query<{ id: number; ip_address: string }>(
      `SELECT id, ip_address FROM session
       WHERE country IS NULL AND ip_address IS NOT NULL AND ip_address <> '' AND id > $1
       ORDER BY id
       LIMIT $2`,
      [cursor, BATCH_SIZE],
    );
    if (rows.length === 0) break;

    const updates: Array<{ id: number; country: string }> = [];
    for (const row of rows) {
      const country = countryFor(reader, row.ip_address.trim());
      if (!country) {
        unplaceable += 1;
        continue;
      }
      tally.set(country, (tally.get(country) ?? 0) + 1);
      updates.push({ id: row.id, country });
    }

    if (updates.length > 0 && !dryRun) {
      // One statement per batch, committed on its own, so an interruption keeps
      // the rows already done.
      await pool.query(
        `UPDATE session AS s SET country = v.country
         FROM (SELECT unnest($1::int[]) AS id, unnest($2::text[]) AS country) AS v
         WHERE s.id = v.id`,
        [updates.map((u) => u.id), updates.map((u) => u.country)],
      );
    }

    placed += updates.length;
    cursor = rows[rows.length - 1]?.id ?? cursor;
    logger.info(`  ${placed} placed, ${unplaceable} unplaceable`);
  }

  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  logger.info('Sessions by country:');
  for (const [country, count] of ranked) {
    logger.info(`  ${country}  ${count}`);
  }
  logger.info(`${placed} placed, ${unplaceable} left null (private, malformed, or not in the database)`);

  await pool.end();
}

main().catch((error) => {
  logger.error({ err: error }, 'Backfill failed');
  process.exit(1);
});
