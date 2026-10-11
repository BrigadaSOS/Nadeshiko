import { beforeAll, afterAll, vi } from 'vitest';
import { AppDataSource } from '@config/database';
import { TestDataSource } from './setup';

/** Patch `AppDataSource.query` to `TestDataSource.query`: raw aggregate callers bypass the patched TypeORM source
 * otherwise, fail with “Connection is not established,” and cannot see seeded rows inside the test transaction.
 * Call once beside `setupTestSuite()`. */
export function useRawQueriesAgainstTestDb(): void {
  beforeAll(() => {
    vi.spyOn(AppDataSource, 'query').mockImplementation(((sql: string, params?: unknown[]) =>
      TestDataSource.query(sql, params)) as typeof AppDataSource.query);
  });

  afterAll(() => {
    vi.mocked(AppDataSource.query).mockRestore?.();
  });
}
