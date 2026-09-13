import '@config/boot';
import { AppDataSource } from '@config/database';
import { reportFatalError } from './reportFatal';

interface StatementRow {
  queryid: string;
  calls: string;
  total_ms: string;
  mean_ms: string;
  max_ms: string;
  rows: string;
  shared_blocks_read: string;
  temp_blocks_written: string;
  query: string;
}

/**
 * Read-only snapshot for the Postgres side of the search path.
 *
 * `pg_stat_statements` is loaded in production, but before this command the only
 * practical incident signal was a 300-character slow-query log line. This keeps
 * the normalized statement, frequency, slow tail and disk/temp pressure in one
 * output that can be captured before a restart clears the useful context.
 */
async function main(): Promise<void> {
  await AppDataSource.initialize();

  const statements = await AppDataSource.query<StatementRow[]>(`
    SELECT
      queryid::text,
      calls::text,
      round(total_exec_time::numeric, 1)::text AS total_ms,
      round(mean_exec_time::numeric, 1)::text AS mean_ms,
      round(max_exec_time::numeric, 1)::text AS max_ms,
      rows::text,
      shared_blks_read::text AS shared_blocks_read,
      temp_blks_written::text AS temp_blocks_written,
      left(regexp_replace(query, '\\s+', ' ', 'g'), 800) AS query
    FROM pg_stat_statements
    WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND query ILIKE '%"Media"%'
    ORDER BY total_exec_time DESC
    LIMIT 20
  `);

  const tables = await AppDataSource.query(`
    SELECT
      relname AS table,
      seq_scan,
      idx_scan,
      n_live_tup,
      n_dead_tup,
      last_autovacuum,
      last_autoanalyze
    FROM pg_stat_user_tables
    WHERE relname IN ('Media', 'Episode', 'MediaExternalId')
    ORDER BY relname
  `);

  console.log(JSON.stringify({ capturedAt: new Date().toISOString(), statements, tables }, null, 2));
}

main()
  .catch((error) => {
    reportFatalError('Search database diagnostics failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });
