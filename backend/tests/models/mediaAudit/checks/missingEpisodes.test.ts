import { describe, it, expect } from 'bun:test';
import { setupTestSuite, TestDataSource } from '../../../helpers/setup';
import { Media, Episode, CategoryType, SegmentStorage } from '@app/models';
import { missingEpisodes } from '@app/models/mediaAudit/checks/missingEpisodes';

setupTestSuite();

function createMedia(overrides: Partial<Media> = {}) {
  return Media.create({
    nameJa: 'テスト',
    nameRomaji: 'Test Anime',
    nameEn: 'Test Anime',
    slug: 'test-anime',
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

describe('missingEpisodes check', () => {
  it('detects gaps in episode numbering', async () => {
    const media = createMedia({ nameRomaji: 'Gappy Show' });
    await media.save();
    await Episode.create({ mediaId: media.id, episodeNumber: 1 }).save();
    await Episode.create({ mediaId: media.id, episodeNumber: 3 }).save();
    await Episode.create({ mediaId: media.id, episodeNumber: 5 }).save();

    const results = await missingEpisodes.run({
      threshold: {},
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      targetType: 'MEDIA',
      mediaId: media.id,
    });
    expect(results[0].data.missingEpisodes).toEqual([2, 4]);
    expect(results[0].data.missingCount).toBe(2);
    expect(results[0].description).toContain('Gappy Show');
  });

  it('returns empty for consecutive episodes', async () => {
    const media = createMedia();
    await media.save();
    await Episode.create({ mediaId: media.id, episodeNumber: 1 }).save();
    await Episode.create({ mediaId: media.id, episodeNumber: 2 }).save();
    await Episode.create({ mediaId: media.id, episodeNumber: 3 }).save();

    const results = await missingEpisodes.run({
      threshold: {},
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(0);
  });

  it('skips media with only one episode', async () => {
    const media = createMedia();
    await media.save();
    await Episode.create({ mediaId: media.id, episodeNumber: 1 }).save();

    const results = await missingEpisodes.run({
      threshold: {},
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(0);
  });

  it('filters by category', async () => {
    const anime = createMedia({ nameRomaji: 'Anime', slug: 'anime' });
    await anime.save();
    await Episode.create({ mediaId: anime.id, episodeNumber: 1 }).save();
    await Episode.create({ mediaId: anime.id, episodeNumber: 5 }).save();

    const drama = createMedia({ nameRomaji: 'Drama', slug: 'drama', category: CategoryType.JDRAMA });
    await drama.save();
    await Episode.create({ mediaId: drama.id, episodeNumber: 1 }).save();
    await Episode.create({ mediaId: drama.id, episodeNumber: 5 }).save();

    const results = await missingEpisodes.run({
      threshold: {},
      category: CategoryType.JDRAMA,
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(1);
    expect(results[0].mediaId).toBe(drama.id);
  });
});
