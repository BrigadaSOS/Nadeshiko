import { describe, it, expect } from 'bun:test';
import { setupTestSuite, TestDataSource } from '../../../helpers/setup';
import { Media, Episode, CategoryType, SegmentStorage } from '@app/models';
import { mediaWithNoEpisodes } from '@app/models/mediaAudit/checks/mediaWithNoEpisodes';

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

describe('mediaWithNoEpisodes check', () => {
  it('flags media with zero episodes', async () => {
    const media = createMedia({ nameRomaji: 'Empty Show' });
    await media.save();

    const results = await mediaWithNoEpisodes.run({
      threshold: {},
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      targetType: 'MEDIA',
      mediaId: media.id,
    });
    expect(results[0].description).toContain('Empty Show');
  });

  it('does not flag media that has episodes', async () => {
    const media = createMedia();
    await media.save();
    await Episode.create({ mediaId: media.id, episodeNumber: 1 }).save();

    const results = await mediaWithNoEpisodes.run({
      threshold: {},
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(0);
  });

  it('filters by category', async () => {
    const anime = createMedia({ nameRomaji: 'Anime' });
    await anime.save();

    const drama = createMedia({ nameRomaji: 'Drama', category: CategoryType.JDRAMA });
    await drama.save();

    const results = await mediaWithNoEpisodes.run({
      threshold: {},
      category: CategoryType.JDRAMA,
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(1);
    expect(results[0].mediaId).toBe(drama.id);
  });

});
