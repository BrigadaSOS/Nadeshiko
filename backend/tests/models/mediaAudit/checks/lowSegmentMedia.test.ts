import { describe, it, expect } from 'bun:test';
import { setupTestSuite, TestDataSource } from '../../../helpers/setup';
import { Media, Episode, CategoryType, SegmentStorage } from '@app/models';
import { lowSegmentMedia } from '@app/models/mediaAudit/checks/lowSegmentMedia';

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

describe('lowSegmentMedia check', () => {
  it('flags media with low average segments per episode', async () => {
    const media = createMedia({ nameRomaji: 'Low Seg Show', segmentCount: 30 });
    await media.save();
    await Episode.create({ mediaId: media.id, episodeNumber: 1 }).save();
    await Episode.create({ mediaId: media.id, episodeNumber: 2 }).save();
    await Episode.create({ mediaId: media.id, episodeNumber: 3 }).save();

    const results = await lowSegmentMedia.run({
      threshold: { minAvgSegmentsPerEpisode: 100 },
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      targetType: 'MEDIA',
      mediaId: media.id,
      data: { avgSegPerEp: 10, episodeCount: 3, segmentCount: 30 },
    });
    expect(results[0].description).toContain('Low Seg Show');
  });

  it('does not flag media above the threshold', async () => {
    const media = createMedia({ segmentCount: 500 });
    await media.save();
    await Episode.create({ mediaId: media.id, episodeNumber: 1 }).save();
    await Episode.create({ mediaId: media.id, episodeNumber: 2 }).save();

    const results = await lowSegmentMedia.run({
      threshold: { minAvgSegmentsPerEpisode: 100 },
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(0);
  });

  it('excludes media with zero episodes', async () => {
    const media = createMedia({ segmentCount: 10 });
    await media.save();

    const results = await lowSegmentMedia.run({
      threshold: { minAvgSegmentsPerEpisode: 100 },
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(0);
  });

  it('filters by category when provided', async () => {
    const anime = createMedia({ nameRomaji: 'Anime Show', segmentCount: 10 });
    await anime.save();
    await Episode.create({ mediaId: anime.id, episodeNumber: 1 }).save();

    const drama = createMedia({ nameRomaji: 'Drama Show', segmentCount: 10, category: CategoryType.JDRAMA });
    await drama.save();
    await Episode.create({ mediaId: drama.id, episodeNumber: 1 }).save();

    const results = await lowSegmentMedia.run({
      threshold: { minAvgSegmentsPerEpisode: 100 },
      category: CategoryType.JDRAMA,
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(1);
    expect(results[0].mediaId).toBe(drama.id);
  });

  it('computes fractional averages correctly', async () => {
    const media = createMedia({ segmentCount: 7 });
    await media.save();
    await Episode.create({ mediaId: media.id, episodeNumber: 1 }).save();
    await Episode.create({ mediaId: media.id, episodeNumber: 2 }).save();

    const results = await lowSegmentMedia.run({
      threshold: { minAvgSegmentsPerEpisode: 100 },
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(1);
    expect(results[0].data.avgSegPerEp).toBe(3.5);
  });
});
