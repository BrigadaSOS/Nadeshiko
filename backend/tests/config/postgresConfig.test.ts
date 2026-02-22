import { describe, expect, it } from 'bun:test';
import { type AppConfig, config } from '@config/config';
import { getAdminPostgresConfig, getAppPostgresConfig } from '@config/postgresConfig';

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...config, ...overrides } as AppConfig;
}

describe('getAppPostgresConfig', () => {
  it('returns application database credentials directly from config', () => {
    const cfg = makeConfig({
      POSTGRES_HOST: 'app-host',
      POSTGRES_PORT: 5455,
      POSTGRES_USER: 'app-user',
      POSTGRES_PASSWORD: 'app-pass',
      POSTGRES_DB: 'app-db',
    });

    expect(getAppPostgresConfig(cfg)).toEqual({
      host: 'app-host',
      port: 5455,
      user: 'app-user',
      password: 'app-pass',
      database: 'app-db',
    });
  });
});

describe('getAdminPostgresConfig', () => {
  it('prefers admin values when provided', () => {
    const cfg = makeConfig({
      POSTGRES_HOST: 'base-host',
      POSTGRES_PORT: 5432,
      POSTGRES_USER: 'base-user',
      POSTGRES_PASSWORD: 'base-pass',
      POSTGRES_ADMIN_HOST: 'admin-host',
      POSTGRES_ADMIN_PORT: 6543,
      POSTGRES_ADMIN_USER: 'admin-user',
      POSTGRES_ADMIN_PASSWORD: 'admin-pass',
      POSTGRES_ADMIN_DB: 'admin-db',
    });

    expect(getAdminPostgresConfig(cfg)).toEqual({
      host: 'admin-host',
      port: 6543,
      user: 'admin-user',
      password: 'admin-pass',
      database: 'admin-db',
    });
  });

  it('falls back to app values and postgres database default', () => {
    const cfg = makeConfig({
      POSTGRES_HOST: 'base-host',
      POSTGRES_PORT: 5432,
      POSTGRES_USER: 'base-user',
      POSTGRES_PASSWORD: 'base-pass',
      POSTGRES_ADMIN_HOST: undefined,
      POSTGRES_ADMIN_PORT: undefined,
      POSTGRES_ADMIN_USER: undefined,
      POSTGRES_ADMIN_PASSWORD: undefined,
      POSTGRES_ADMIN_DB: undefined,
    });

    expect(getAdminPostgresConfig(cfg)).toEqual({
      host: 'base-host',
      port: 5432,
      user: 'base-user',
      password: 'base-pass',
      database: 'postgres',
    });
  });
});
