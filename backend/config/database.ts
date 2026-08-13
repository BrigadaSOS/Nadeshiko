import '@config/boot';
import { DataSource } from 'typeorm';
import { APP_ENTITIES, APP_SUBSCRIBERS } from '@config/schema';
import { getAppPostgresConfig } from '@config/postgresConfig';
import { InstrumentedTypeOrmLogger } from '@app/middleware/dbInstrumentation';
import { getMeter } from '@config/telemetry';
import { logger } from '@config/log';

const postgres = getAppPostgresConfig();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: postgres.host,
  port: postgres.port,
  username: postgres.user,
  password: postgres.password,
  database: postgres.database,
  entities: APP_ENTITIES,
  subscribers: APP_SUBSCRIBERS,
  migrations: ['./db/migrations/**/*.ts'],
  synchronize: false, // Use migrations instead!
  logging: true,
  // TypeORM only calls `logQuerySlow` when this is truthy and exceeded, and that
  // is the hook InstrumentedTypeOrmLogger records durations from. 0 disabled it
  // entirely; 1 means everything above a millisecond is measured.
  maxQueryExecutionTime: 1,
  logger: new InstrumentedTypeOrmLogger(),
  extra: {
    // Sized when the API served ~20 req/min. That is no longer the shape of the
    // traffic: on 2026-08-12 at 21:15 UTC it stepped up ~6-8x (HTTP 0.8 -> 5-8
    // req/s sustained, DB 1.6 -> 8-13 queries/s) and the pool went from sitting
    // at its min of 5 to pinned at 15, where it has stayed. It is coping --
    // waitingCount is 0 and Postgres shows no active backends -- so this is not
    // urgent, but the old "7.5x headroom" claim is simply no longer true and the
    // next step up in traffic is what would start queueing.
    // NadeshikoPostgresPoolNearCapacity now watches for that.
    max: 15,
    min: 5, // Keep warm pool for low traffic
    acquireTimeoutMillis: 60000, // 60s to acquire from pool (fail slow if stuck)
    idleTimeoutMillis: 300000, // 5min idle timeout (was 45s) - prevents connection churn
  },
});

function registerPoolMetrics(): void {
  const pool = (AppDataSource.driver as any).master;
  if (!pool) return;

  const meter = getMeter();
  const attrs = { 'db.system.name': 'postgresql' };

  meter
    .createObservableGauge('db.client.connection.count', {
      description: 'Current number of connections in the pool',
      unit: '{connection}',
    })
    .addCallback((obs) => {
      // `used` is the checked-out count, not the pool size: node-postgres'
      // totalCount already includes the idle ones, so reporting it here made
      // `used` and `idle` read identically (both 15) whenever the pool was
      // fully expanded, which looks like saturation and never is.
      obs.observe(pool.totalCount - pool.idleCount, {
        ...attrs,
        'db.client.connection.state': 'used',
      });
      obs.observe(pool.idleCount, { ...attrs, 'db.client.connection.state': 'idle' });
    });

  meter
    .createObservableGauge('db.client.connection.pending_requests', {
      description: 'Number of queued requests waiting for a connection',
      unit: '{request}',
    })
    .addCallback((obs) => {
      obs.observe(pool.waitingCount, attrs);
    });

  meter
    .createObservableGauge('db.client.connection.max', {
      description: 'Maximum number of connections in the pool',
      unit: '{connection}',
    })
    .addCallback((obs) => {
      obs.observe(pool.options?.max ?? 15, attrs);
    });
}

export async function initializeDatabase(): Promise<void> {
  try {
    await AppDataSource.initialize();
    registerPoolMetrics();
    logger.info('Database connection established successfully');
  } catch (error) {
    logger.error(error, 'Database connection failed');
    throw error;
  }
}

export async function runMigrations(): Promise<void> {
  try {
    await AppDataSource.runMigrations();
    logger.info('Database migrations completed successfully');
  } catch (error) {
    logger.error(error, 'Database migrations failed');
    throw error;
  }
}

export { AppDataSource as connection };
