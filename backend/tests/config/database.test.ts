import { afterEach, describe, expect, it, vi } from 'bun:test';
import { AppDataSource, initializeDatabase, runMigrations } from '@config/database';
import { logger } from '@config/log';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('initializeDatabase', () => {
  it('logs success when database initialization succeeds', async () => {
    vi.spyOn(AppDataSource, 'initialize').mockResolvedValueOnce(AppDataSource as any);
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => logger);

    await initializeDatabase();

    expect(infoSpy).toHaveBeenCalledWith('Database connection established successfully');
  });

  it('logs and rethrows when initialization fails', async () => {
    const error = new Error('db init failed');
    vi.spyOn(AppDataSource, 'initialize').mockRejectedValueOnce(error);
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);

    await expect(initializeDatabase()).rejects.toThrow('db init failed');
    expect(errorSpy).toHaveBeenCalledWith(error, 'Database connection failed');
  });
});

describe('runMigrations', () => {
  it('logs success when migrations complete', async () => {
    vi.spyOn(AppDataSource, 'runMigrations').mockResolvedValueOnce([] as any);
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => logger);

    await runMigrations();

    expect(infoSpy).toHaveBeenCalledWith('Database migrations completed successfully');
  });

  it('logs and rethrows when migrations fail', async () => {
    const error = new Error('migration failed');
    vi.spyOn(AppDataSource, 'runMigrations').mockRejectedValueOnce(error);
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);

    await expect(runMigrations()).rejects.toThrow('migration failed');
    expect(errorSpy).toHaveBeenCalledWith(error, 'Database migrations failed');
  });
});
