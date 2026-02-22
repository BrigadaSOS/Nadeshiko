import { describe, it, expect } from 'bun:test';
import { setupTestSuite, TestDataSource } from '../../../helpers/setup';
import { Media, CategoryType, SegmentStorage } from '@app/models';
import { dbEsSyncIssues } from '@app/models/mediaAudit/checks/dbEsSyncIssues';
import type { Client } from '@elastic/elasticsearch';

setupTestSuite();

function createMedia(overrides: Partial<Media> = {}) {
  return Media.create({
    nameJa: 'テスト',
    nameRomaji: 'Test Anime',
    nameEn: 'Test Anime',
    airingFormat: 'TV',
    airingStatus: 'FINISHED',
    genres: ['Action'],
    storage: SegmentStorage.R2,
    startDate: '2024-01-01',
    studio: 'Studio A',
    seasonName: 'WINTER',
    seasonYear: 2024,
    category: CategoryType.ANIME,
    segmentCount: 0,
    version: '1',
    storageBasePath: '/test',
    ...overrides,
  });
}

function mockEsClient(buckets: Array<{ key: number; doc_count: number }>): Client {
  return {
    search: async () => ({
      aggregations: {
        media: { buckets },
      },
    }),
  } as unknown as Client;
}

describe('dbEsSyncIssues check', () => {
  it('returns empty when esClient is not provided', async () => {
    const results = await dbEsSyncIssues.run({
      threshold: { minDifference: 5 },
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(0);
  });

  it('flags media where DB and ES counts diverge beyond threshold', async () => {
    const media = createMedia({ nameRomaji: 'Out of Sync', segmentCount: 100 });
    await media.save();

    const esClient = mockEsClient([{ key: media.id, doc_count: 80 }]);

    const results = await dbEsSyncIssues.run({
      threshold: { minDifference: 5 },
      dataSource: TestDataSource,
      esClient,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      targetType: 'MEDIA',
      mediaId: media.id,
      data: { dbCount: 100, esCount: 80, difference: 20 },
    });
    expect(results[0].description).toContain('Out of Sync');
  });

  it('does not flag media within threshold', async () => {
    const media = createMedia({ segmentCount: 100 });
    await media.save();

    const esClient = mockEsClient([{ key: media.id, doc_count: 98 }]);

    const results = await dbEsSyncIssues.run({
      threshold: { minDifference: 5 },
      dataSource: TestDataSource,
      esClient,
    });

    expect(results).toHaveLength(0);
  });

  it('flags when ES has more than DB (negative difference)', async () => {
    const media = createMedia({ segmentCount: 10 });
    await media.save();

    const esClient = mockEsClient([{ key: media.id, doc_count: 50 }]);

    const results = await dbEsSyncIssues.run({
      threshold: { minDifference: 5 },
      dataSource: TestDataSource,
      esClient,
    });

    expect(results).toHaveLength(1);
    expect(results[0].data.difference).toBe(-40);
  });

  it('treats missing ES entry as 0 count', async () => {
    const media = createMedia({ segmentCount: 20 });
    await media.save();

    const esClient = mockEsClient([]);

    const results = await dbEsSyncIssues.run({
      threshold: { minDifference: 5 },
      dataSource: TestDataSource,
      esClient,
    });

    expect(results).toHaveLength(1);
    expect(results[0].data.esCount).toBe(0);
  });

  it('filters by category', async () => {
    const anime = createMedia({ nameRomaji: 'Anime', segmentCount: 100 });
    await anime.save();

    const drama = createMedia({ nameRomaji: 'Drama', segmentCount: 100, category: CategoryType.JDRAMA });
    await drama.save();

    const esClient = mockEsClient([]);

    const results = await dbEsSyncIssues.run({
      threshold: { minDifference: 5 },
      category: CategoryType.JDRAMA,
      dataSource: TestDataSource,
      esClient,
    });

    expect(results).toHaveLength(1);
    expect(results[0].mediaId).toBe(drama.id);
  });
});
