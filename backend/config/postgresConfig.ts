import { config, type AppConfig } from '@config/config';

export interface PostgresConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function getAppPostgresConfig(configValues: AppConfig = config): PostgresConnectionConfig {
  return {
    host: configValues.POSTGRES_HOST,
    port: configValues.POSTGRES_PORT,
    user: configValues.POSTGRES_USER,
    password: configValues.POSTGRES_PASSWORD,
    database: configValues.POSTGRES_DB,
  };
}

export function getAdminPostgresConfig(configValues: AppConfig = config): PostgresConnectionConfig {
  return {
    host: configValues.POSTGRES_ADMIN_HOST || configValues.POSTGRES_HOST,
    port: configValues.POSTGRES_ADMIN_PORT || configValues.POSTGRES_PORT,
    user: configValues.POSTGRES_ADMIN_USER || configValues.POSTGRES_USER,
    password: configValues.POSTGRES_ADMIN_PASSWORD || configValues.POSTGRES_PASSWORD,
    database: configValues.POSTGRES_ADMIN_DB || 'postgres',
  };
}
