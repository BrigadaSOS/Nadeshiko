import '@config/boot';
import { DataSource } from 'typeorm';
import { APP_ENTITIES, APP_SUBSCRIBERS } from '@config/schema';
import { getAppPostgresConfig } from '@config/postgresConfig';
import { InstrumentedTypeOrmLogger } from '@app/middleware/dbInstrumentation';
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
    max: 20,
    min: 5,
    acquireTimeoutMillis: 60000,
    idleTimeoutMillis: 5000,
  },
});

export async function initializeDatabase(): Promise<void> {
  try {
    await AppDataSource.initialize();
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
