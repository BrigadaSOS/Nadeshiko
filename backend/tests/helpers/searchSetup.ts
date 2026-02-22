import 'dotenv/config';
import { beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { client as esClient, INDEX_NAME } from '@config/elasticsearch';
import { TestDataSource } from './setup';

export { createTestApp, signInAs } from './setup';

/**
 * Search test suite setup — opts out of transaction isolation.
 *
 * Mirrors Rails' SearchTestHelper which sets `use_transactional_tests = false`.
 * Since Elasticsearch sits outside the DB transaction, tests that exercise the
 * full search stack need committed data so the ES sync job can see it.
 *
 * Isolation is achieved via explicit TRUNCATE + ES cleanup instead of
 * transaction rollback. Tests in search suite files still run serially, but
 * data is committed to both the DB and ES index.
 *
 * Pattern:
 *   - beforeAll:  Initialize DB connection (once per file).
 *   - beforeEach: Clear ES index + seed core fixtures + sign in as kevin.
 *   - afterEach:  Clear ES index + truncate test data from DB.
 *   - afterAll:   Destroy DB connection.
 *
 * Use setupSearchSuite() instead of setupTestSuite() in search test files.
 *
 * Test file pattern:
 *   setupSearchSuite();               // replaces setupTestSuite()
 *   const app = createTestApp();
 *   let fixtures: CoreFixtures;
 *   beforeAll(async () => { fixtures = await seedCoreFixtures(); });
 *   beforeEach(() => { signInAs(app, fixtures.users.kevin); });
 *
 * @example
 * // searchController.test.ts
 * import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
 * import { setupSearchSuite, createTestApp, signInAs } from '../helpers/searchSetup';
 * import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
 * import { performEnqueuedJobs } from '../helpers/jobs';
 *
 * setupSearchSuite();
 * const app = createTestApp();
 * let fixtures: CoreFixtures;
 * beforeAll(async () => { fixtures = await seedCoreFixtures(); });
 * beforeEach(() => { signInAs(app, fixtures.users.kevin); });
 *
 * describe('GET /v1/search', () => {
 *   it('returns matching segments', async () => {
 *     await performEnqueuedJobs(async () => {
 *       await Segment.save({ contentJa: '猫が好き', ... });
 *     });
 *     const res = await request(app).get('/v1/search?q=猫');
 *     expect(res.body.results).toHaveLength(1);
 *   });
 * });
 */
export function setupSearchSuite() {
  beforeAll(async () => {
    await TestDataSource.initialize();
  });

  beforeEach(async () => {
    await clearEsIndex();
  });

  afterEach(async () => {
    await clearEsIndex();
    // Truncate test-specific tables. Core user fixtures (User) are preserved
    // since they are not referenced by foreign keys from these tables.
    await TestDataSource.query(`TRUNCATE "Segment", "Episode", "Media", "Series", "Seiyuu" RESTART IDENTITY CASCADE`);
  });

  afterAll(async () => {
    if (TestDataSource.isInitialized) {
      await TestDataSource.destroy();
    }
  });
}

/**
 * Delete all documents from the ES index.
 * Faster than recreating the index — mappings and settings are preserved.
 */
async function clearEsIndex(): Promise<void> {
  try {
    await esClient.deleteByQuery({
      index: INDEX_NAME,
      body: { query: { match_all: {} } },
      refresh: true,
    });
  } catch {
    // Index may not exist yet on first run — that's fine.
  }
}
