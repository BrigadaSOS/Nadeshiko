import { describe, it, expect, beforeEach } from 'bun:test';
import { setupTestSuite, TestDataSource } from '../../../helpers/setup';
import { Media, Episode, CategoryType, SegmentStorage } from '@app/models';
import { emptyEpisodes } from '@app/models/mediaAudit/checks/emptyEpisodes';

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

describe('emptyEpisodes check', () => {
  let media: Media;

  beforeEach(async () => {
    media = createMedia({ nameRomaji: 'Naruto' });
    await media.save();
  });

  it('returns episodes below the segment threshold', async () => {
    await Episode.create({ mediaId: media.id, episodeNumber: 1, segmentCount: 5 }).save();
    await Episode.create({ mediaId: media.id, episodeNumber: 2, segmentCount: 50 }).save();

    const results = await emptyEpisodes.run({
      threshold: { minSegments: 10 },
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      targetType: 'EPISODE',
      mediaId: media.id,
      episodeNumber: 1,
      data: { segmentCount: 5 },
    });
    expect(results[0].description).toContain('Naruto EP1');
  });

  it('returns empty when all episodes are above threshold', async () => {
    await Episode.create({ mediaId: media.id, episodeNumber: 1, segmentCount: 100 }).save();

    const results = await emptyEpisodes.run({
      threshold: { minSegments: 10 },
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(0);
  });

  it('includes episodes with zero segments', async () => {
    await Episode.create({ mediaId: media.id, episodeNumber: 1, segmentCount: 0 }).save();

    const results = await emptyEpisodes.run({
      threshold: { minSegments: 1 },
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(1);
    expect(results[0].data.segmentCount).toBe(0);
  });

  it('filters by category when provided', async () => {
    const drama = createMedia({ nameRomaji: 'Drama', category: CategoryType.JDRAMA });
    await drama.save();

    await Episode.create({ mediaId: media.id, episodeNumber: 1, segmentCount: 0 }).save();
    await Episode.create({ mediaId: drama.id, episodeNumber: 1, segmentCount: 0 }).save();

    const results = await emptyEpisodes.run({
      threshold: { minSegments: 10 },
      category: CategoryType.JDRAMA,
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(1);
    expect(results[0].mediaId).toBe(drama.id);
  });

});
