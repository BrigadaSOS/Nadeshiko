import { beforeAll, afterAll, vi } from 'vitest';
import { AppDataSource } from '@config/database';
import { TestDataSource } from './setup';

/**
 * Points `AppDataSource.query` at the test database.
 *
 * A handful of controllers drop to raw SQL for aggregates that TypeORM's query
 * builder cannot express well -- `COUNT(*) FILTER (WHERE ...)` over a tier list,
 * the admin dashboard's user roll-up -- and they reach for `AppDataSource`
 * directly rather than going through an entity. `setupTestSuite` never
 * initializes that DataSource (it patches `TestDataSource`), so every one of
 * those calls threw `Connection is not established`, the endpoint answered 500,
 * and the code was untestable rather than merely untested.
 *
 * Delegating to `TestDataSource.query` runs the same SQL through the patched
 * `createQueryRunner`, which means it lands INSIDE the per-test transaction and
 * sees rows the test has just seeded -- the whole point of doing it this way
 * rather than stubbing the aggregate with a fixed row.
 *
 * Call once, beside `setupTestSuite()`.
 */
export function useRawQueriesAgainstTestDb(): void {
  beforeAll(() => {
    vi.spyOn(AppDataSource, 'query').mockImplementation(((sql: string, params?: unknown[]) =>
      TestDataSource.query(sql, params)) as typeof AppDataSource.query);
  });

  afterAll(() => {
    vi.mocked(AppDataSource.query).mockRestore?.();
  });
}
