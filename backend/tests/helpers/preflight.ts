import { Client } from 'pg';
import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_VALUES = new Set(['1', 'true', 'yes']);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '../..');

loadDotenv({ path: path.join(backendRoot, '.env.test'), quiet: true });
loadDotenv({ path: path.join(backendRoot, '.env'), quiet: true });

interface PostgresTarget {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

function resolvePostgresTarget(): PostgresTarget {
  return {
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? 'nadeshiko',
    password: process.env.POSTGRES_PASSWORD ?? 'nadeshiko',
    database: process.env.POSTGRES_DB ?? 'nadeshiko_test',
  };
}

function formatConnectionError(error: unknown): string {
  if (error instanceof AggregateError) {
    const nested = error.errors.map(formatConnectionError).filter(Boolean);
    if (nested.length > 0) return nested.join(' | ');
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    const candidate = error as {
      message?: unknown;
      code?: unknown;
      address?: unknown;
      port?: unknown;
    };
    const parts = [candidate.message, candidate.code, candidate.address, candidate.port]
      .filter((value) => typeof value === 'string' || typeof value === 'number')
      .map(String);
    if (parts.length > 0) return parts.join(' ');
  }

  const fallback = String(error);
  return fallback === '[object Object]' ? '' : fallback;
}

async function assertTestDatabaseReachable(): Promise<void> {
  if (SKIP_VALUES.has((process.env.SKIP_DB_PREFLIGHT ?? '').toLowerCase())) {
    return;
  }

  const postgres = resolvePostgresTarget();
  const client = new Client({
    host: postgres.host,
    port: postgres.port,
    user: postgres.user,
    password: postgres.password,
    database: postgres.database,
    connectionTimeoutMillis: 1500,
  });

  try {
    await client.connect();
  } catch (error) {
    const details = formatConnectionError(error);

    console.error('\n[Test preflight] Could not connect to PostgreSQL.');
    console.error(`[Test preflight] Target: ${postgres.host}:${postgres.port}/${postgres.database}`);
    if (details) {
      console.error(`[Test preflight] Details: ${details}`);
    }
    console.error('[Test preflight] Start dependencies first:');
    console.error('  cd backend && docker compose up -d postgres');
    console.error('[Test preflight] Then prepare schema:');
    console.error('  bun run test:setup');
    console.error('[Test preflight] To bypass this check for DB-free tests:');
    console.error('  SKIP_DB_PREFLIGHT=1 bun test <path>');
    process.exit(1);
  } finally {
    await client.end().catch(() => undefined);
  }
}

await assertTestDatabaseReachable();
