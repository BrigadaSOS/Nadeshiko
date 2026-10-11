import 'dotenv/config';
import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { client as esClient, INDEX_NAME } from '@config/elasticsearch';
import { TestDataSource } from './setup';
import { isElasticsearchNotFound } from '@lib/elasticsearchErrors';

export { createTestApp, signInAs } from './setup';

/** Search setup opts out of transactions because Elasticsearch cannot see uncommitted rows. It isolates files with
 * committed DB data plus explicit ES cleanup. */
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
    await TestDataSource.query(`TRUNCATE "Segment", "Episode", "Media" RESTART IDENTITY CASCADE`);
  });

  afterAll(async () => {
    if (TestDataSource.isInitialized) {
      await TestDataSource.destroy();
    }
  });
}

/** Delete ES documents while preserving mappings and settings; a missing index is harmless on the first run. */
async function clearEsIndex(): Promise<void> {
  try {
    // Client v9 takes the query at the top level; the old `body` wrapper is gone.
    await esClient.deleteByQuery({
      index: INDEX_NAME,
      query: { match_all: {} },
      refresh: true,
    });
  } catch (error) {
    // Only a missing index is expected here; swallow no other error or documents can leak into the next search test.
    if (!isElasticsearchNotFound(error)) throw error;
  }
}
