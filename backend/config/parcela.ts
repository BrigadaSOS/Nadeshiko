import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';

const ADMIN_LOGINS = [
  'POSTGRES_ADMIN_USER',
  'POSTGRES_ADMIN_PASSWORD',
  'ELASTICSEARCH_ADMIN_USER',
  'ELASTICSEARCH_ADMIN_PASSWORD',
] as const;

/**
 * Under Parcela each environment runs its own PostgreSQL and Elasticsearch containers on leased
 * ports, created with the admin logins from `backend/.env`. `.env.test` names the test database,
 * user and index but points at the default ports and CI's admin logins, so tests re-point it at
 * this environment's containers. Outside Parcela this does nothing.
 */
export function applyParcelaTestEnvironment(environment: NodeJS.ProcessEnv, backendRoot: string): void {
  const postgres = environment.PARCELA_PORT_POSTGRES;
  const elasticsearch = environment.PARCELA_PORT_ELASTICSEARCH;
  if (!postgres || !elasticsearch) return;
  let local: Record<string, string> = {};
  try {
    local = parse(readFileSync(join(backendRoot, '.env')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  Object.assign(environment, {
    POSTGRES_HOST: '127.0.0.1',
    POSTGRES_PORT: postgres,
    POSTGRES_ADMIN_HOST: '127.0.0.1',
    POSTGRES_ADMIN_PORT: postgres,
    POSTGRES_ADMIN_DB: 'postgres',
    ELASTICSEARCH_HOST: `http://127.0.0.1:${elasticsearch}`,
  });
  for (const key of ADMIN_LOGINS) {
    const value = local[key];
    if (value) environment[key] = value;
  }
}
