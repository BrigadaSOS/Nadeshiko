import { config } from '@lib/config';

export interface PostgresConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function getAppPostgresConfig(): PostgresConnectionConfig {
  return {
    host: config.POSTGRES_HOST,
    port: config.POSTGRES_PORT,
    user: config.POSTGRES_USER,
    password: config.POSTGRES_PASSWORD,
    database: config.POSTGRES_DB,
  };
}

export function getAdminPostgresConfig(): PostgresConnectionConfig {
  return {
    host: config.POSTGRES_ADMIN_HOST || config.POSTGRES_HOST,
    port: config.POSTGRES_ADMIN_PORT || config.POSTGRES_PORT,
    user: config.POSTGRES_ADMIN_USER || config.POSTGRES_USER,
    password: config.POSTGRES_ADMIN_PASSWORD || config.POSTGRES_PASSWORD,
    database: config.POSTGRES_ADMIN_DB || 'postgres',
  };
}
