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
  maxQueryExecutionTime: 0,
  logger: new InstrumentedTypeOrmLogger(),
  extra: {
    max: 15,                      // Reduced from 20 - still 7.5x peak needs for 20 req/min
    min: 5,                       // Keep warm pool for low traffic
    acquireTimeoutMillis: 60000, // 60s to acquire from pool (fail slow if stuck)
    idleTimeoutMillis: 300000,    // 5min idle timeout (was 45s) - prevents connection churn
  },
});

function registerPoolMetrics(): void {
  const pool = (AppDataSource.driver as any).master;
  if (!pool) return;

  const meter = getMeter();
  const attrs = { 'db.system.name': 'postgresql' };

  meter.createObservableGauge('db.client.connection.count', {
    description: 'Current number of connections in the pool',
    unit: '{connection}',
  }).addCallback((obs) => {
    obs.observe(pool.totalCount, { ...attrs, 'db.client.connection.state': 'used' });
    obs.observe(pool.idleCount, { ...attrs, 'db.client.connection.state': 'idle' });
  });

  meter.createObservableGauge('db.client.connection.pending_requests', {
    description: 'Number of queued requests waiting for a connection',
    unit: '{request}',
  }).addCallback((obs) => {
    obs.observe(pool.waitingCount, attrs);
  });

  meter.createObservableGauge('db.client.connection.max', {
    description: 'Maximum number of connections in the pool',
    unit: '{connection}',
  }).addCallback((obs) => {
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
