import type { Logger as TypeOrmLogger, QueryRunner } from 'typeorm';
import { getMeter } from '@config/telemetry';
import { config } from '@config/config';
import { logger } from '@config/log';
import { getDbLogging } from '@config/schema';

const DB_DURATION_BUCKETS = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10];

const meter = getMeter();

const operationDuration = meter.createHistogram('db.postgresql.operation.duration', {
  description: 'Duration of PostgreSQL client operations',
  unit: 's',
  advice: { explicitBucketBoundaries: DB_DURATION_BUCKETS },
});

function extractOperation(query: string): string {
  const trimmed = query.trimStart().toUpperCase();
  const firstWord = trimmed.split(/\s/)[0];
  return firstWord || 'UNKNOWN';
}

function extractTable(query: string): string | undefined {
  const match = query.match(/(?:FROM|INTO|UPDATE|JOIN)\s+"?(\w+)"?/i);
  return match?.[1];
}

function recordQuery(query: string, durationMs: number, failed: boolean) {
  const operation = extractOperation(query);
  const table = extractTable(query);
  const durationS = durationMs / 1000;

  const attrs: Record<string, string | number> = {
    'db.system.name': 'postgresql',
    'db.operation.name': operation,
    'db.namespace': config.POSTGRES_DB,
    'server.address': config.POSTGRES_HOST,
    'server.port': config.POSTGRES_PORT,
  };

  if (table) {
    attrs['db.collection.name'] = table;
  }

  if (failed) {
    attrs['error.type'] = 'query_error';
  }

  operationDuration.record(durationS, attrs);
}

export class InstrumentedTypeOrmLogger implements TypeOrmLogger {
  private verboseLogging: boolean;

  constructor() {
    const logging = getDbLogging();
    this.verboseLogging = logging === true || (Array.isArray(logging) && logging.includes('query'));
  }

  logQuery(query: string, _parameters?: unknown[], _queryRunner?: QueryRunner): void {
    if (this.verboseLogging) {
      const operation = extractOperation(query);
      const table = extractTable(query);
      const label = table ? `${operation} ${table}` : operation;
      logger.debug({ query: query.slice(0, 300) }, label);
    }
  }

  logQuerySlow(time: number, query: string, _parameters?: unknown[], _queryRunner?: QueryRunner): void {
    recordQuery(query, time, false);

    if (time > config.DB_SLOW_QUERY_THRESHOLD_MS) {
      const operation = extractOperation(query);
      const table = extractTable(query);
      const label = table ? `Slow ${operation} ${table}` : `Slow ${operation}`;
      logger.warn({ query: query.slice(0, 300), durationMs: time }, label);
    }
  }

  logQueryError(error: string | Error, query: string, _parameters?: unknown[], _queryRunner?: QueryRunner): void {
    recordQuery(query, 0, true);
    const operation = extractOperation(query);
    const table = extractTable(query);
    const label = table ? `${operation} ${table} error` : `${operation} error`;
    logger.error({ error, query: query.slice(0, 300) }, label);
  }

  logSchemaBuild(message: string): void {
    logger.debug(message);
  }

  logMigration(message: string): void {
    logger.info(message);
  }

  log(level: 'log' | 'info' | 'warn', message: string): void {
    if (level === 'warn') {
      logger.warn(message);
    } else {
      logger.debug(message);
    }
  }
}
