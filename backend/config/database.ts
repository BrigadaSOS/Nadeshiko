import 'dotenv/config';
import { DataSource } from 'typeorm';
import {
  User,
  Role,
  UserRole,
  Media,
  Segment,
  Episode,
  ApiAuth,
  ApiAuthPermission,
  Character,
  Seiyuu,
  MediaCharacter,
  List,
  ListItem,
} from '@app/entities';
import { logger } from '@lib/utils/log';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT),
  username: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  entities: [
    User,
    Role,
    UserRole,
    Media,
    Segment,
    Episode,
    ApiAuth,
    ApiAuthPermission,
    Character,
    Seiyuu,
    MediaCharacter,
    List,
    ListItem,
  ],
  migrations: ['./db/migrations/**/*.ts'],
  synchronize: false, // Use migrations instead!
  logging: false,
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
