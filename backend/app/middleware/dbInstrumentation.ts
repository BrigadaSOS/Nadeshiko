import type { Counter, Histogram, Meter } from '@opentelemetry/api';
import type { Logger as TypeOrmLogger, QueryRunner } from 'typeorm';
import { getMeter } from '@config/telemetry';
import { config } from '@config/config';
import { logger } from '@config/log';
import { getDbLogging } from '@config/schema';

const DB_DURATION_BUCKETS = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10];

function extractOperation(query: string): string {
  const trimmed = query.trimStart().toUpperCase();
  const firstWord = trimmed.split(/\s/)[0];
  return firstWord || 'UNKNOWN';
}

function extractTable(query: string): string | undefined {
  const match = query.match(/(?:FROM|INTO|UPDATE|JOIN)\s+"?(\w+)"?/i);
  return match?.[1];
}

function queryAttributes(query: string): Record<string, string | number> {
  const operation = extractOperation(query);
  const table = extractTable(query);

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

  return attrs;
}

export class InstrumentedTypeOrmLogger implements TypeOrmLogger {
  private verboseLogging: boolean;
  private operationDuration: Histogram;
  private operationErrors: Counter;

  // The meter is resolved per instance rather than at module load: the OTel
  // metrics API binds instruments to whichever provider is registered at
  // creation time, so a module-level meter would silently no-op whenever this
  // file is imported before the SDK starts.
  constructor(meter: Meter = getMeter()) {
    const logging = getDbLogging();
    this.verboseLogging = logging === true || (Array.isArray(logging) && logging.includes('query'));

    this.operationDuration = meter.createHistogram('db.postgresql.operation.duration', {
      description: 'Duration of PostgreSQL client operations',
      unit: 's',
      advice: { explicitBucketBoundaries: DB_DURATION_BUCKETS },
    });

    // TypeORM's error hook carries no timing, so failures are counted separately
    // instead of being folded into the histogram as 0s samples.
    this.operationErrors = meter.createCounter('db.postgresql.operation.errors', {
      description: 'Count of failed PostgreSQL client operations',
      unit: '{operation}',
    });
  }

  private recordQuery(query: string, durationMs: number): void {
    this.operationDuration.record(durationMs / 1000, queryAttributes(query));
  }

  private recordQueryError(query: string): void {
    this.operationErrors.add(1, { ...queryAttributes(query), 'error.type': 'query_error' });
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
    this.recordQuery(query, time);

    if (time > config.DB_SLOW_QUERY_THRESHOLD_MS) {
      const operation = extractOperation(query);
      const table = extractTable(query);
      const label = table ? `Slow ${operation} ${table}` : `Slow ${operation}`;
      logger.warn({ query: query.slice(0, 300), durationMs: time }, label);
    }
  }

  logQueryError(error: string | Error, query: string, _parameters?: unknown[], _queryRunner?: QueryRunner): void {
    this.recordQueryError(query);
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
