/**
 * Fills `session.country` for the rows that predate it, from a local GeoLite2 file.
 *
 * `session.country` is written at sign-in from Cloudflare's `CF-IPCountry`, so
 * it only ever describes sessions created after that shipped. Everything older
 * has an `ip_address` and no country -- 100% of the table carries an address,
 * because better-auth has always stored one -- and this is the one-time pass
 * that resolves them.
 *
 * WHY THIS IS WORTH DOING AT ALL, given sessions expire after 30 days: expired
 * sessions are never deleted. Nothing sweeps the table, so at the time of
 * writing roughly three quarters of it is expired rows going back months. That
 * makes it an accidental historical access log rather than a live-session list,
 * and a backfill into it stays put. It also means the coverage here is far wider
 * than the live sessions alone -- most of the users this can place have no
 * unexpired session at all.
 *
 * A LOCAL FILE AND NOT A LOOKUP SERVICE. Every row here is a real reader's IP
 * address. Posting them to a free geolocation API would resolve them just as
 * well and would also hand a third party, under no agreement with us, the
 * address history of most of our users. The MaxMind database is a file: it is
 * read from disk, nothing leaves the machine, and it can be deleted when the
 * run is done.
 *
 * NOT A RUNTIME DEPENDENCY. `mmdb-lib` is a devDependency and nothing in the
 * application imports it. Once the backfill has run, both it and the `.mmdb`
 * file can go -- the live path reads a header and needs neither.
 *
 * COUNTRY ONLY, to match what the live path can record. The City database would
 * resolve more, and storing it would mean the column meant one thing for rows
 * written at sign-in and another for rows written here.
 *
 * SAFE TO INTERRUPT, AND SAFE TO RE-RUN. Only rows with `country IS NULL` are
 * selected and each batch commits on its own, so a second run resumes where the
 * first stopped and a finished table is a no-op. It never overwrites a country
 * written at sign-in -- those rows are not selected.
 *
 * GETTING THE FILE. GeoLite2-Country.mmdb is free but needs an account:
 * https://www.maxmind.com/en/geolite2/signup -- then Download Databases ->
 * GeoLite2 Country -> GZIP, and untar. Pass the path with `--db`.
 *
 * Usage (locally; `--env-file-if-exists` is what supplies the database config):
 *   node --env-file-if-exists=.env --import tsx scripts/backfill-session-country.ts --db ~/GeoLite2-Country.mmdb --dry-run
 *   node --env-file-if-exists=.env --import tsx scripts/backfill-session-country.ts --db ~/GeoLite2-Country.mmdb
 *
 * Against production, go through the wrapper so the connection and the
 * confirmation are the same ones every other remote write uses:
 *   scripts/remote-db.sh prod backfill-session-country --allow-prod -- --db ~/GeoLite2-Country.mmdb
 */

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

/**
 * The same two-letter shape the live path stores, so a backfilled row and a
 * signed-in row are indistinguishable to a query.
 *
 * `registered_country` is the fallback MaxMind documents for addresses it can
 * place to an owner but not a location -- common for hosting ranges, which is
 * exactly the traffic worth being able to see.
 */
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

  // Keyset-free batching: each pass re-selects rows that are still null, so an
  // interrupted run resumes without tracking an offset. In a dry run nothing is
  // written, so the same rows would be selected forever -- it walks by id.
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
