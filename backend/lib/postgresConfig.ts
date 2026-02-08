export interface PostgresConnectionConfig {
  host?: string;
  port: number;
  user?: string;
  password?: string;
  database?: string;
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getAppPostgresConfig(): PostgresConnectionConfig {
  return {
    host: process.env.POSTGRES_HOST,
    port: parsePort(process.env.POSTGRES_PORT, 5432),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  };
}

export function getAdminPostgresConfig(): PostgresConnectionConfig {
  return {
    host: process.env.POSTGRES_ADMIN_HOST || process.env.POSTGRES_HOST,
    port: parsePort(process.env.POSTGRES_ADMIN_PORT || process.env.POSTGRES_PORT, 5432),
    user: process.env.POSTGRES_ADMIN_USER || process.env.POSTGRES_USER,
    password: process.env.POSTGRES_ADMIN_PASSWORD || process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_ADMIN_DB || 'postgres',
  };
}
