import { describe, it, expect } from 'bun:test';
import { setupTestSuite, TestDataSource } from '../../../helpers/setup';
import {
  Media,
  Episode,
  Segment,
  CategoryType,
  SegmentStorage,
  SegmentStatus,
  ContentRating,
} from '@app/models';
import { badSegmentRatio } from '@app/models/mediaAudit/checks/badSegmentRatio';

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

let segIdx = 0;

function createSegment(mediaId: number, episode: number, status: SegmentStatus) {
  segIdx++;
  return Segment.create({
    uuid: `test-seg-${segIdx}`,
    position: segIdx,
    status,
    startTimeMs: 0,
    endTimeMs: 5000,
    contentJa: 'テスト',
    contentEn: 'test',
    contentEnMt: false,
    contentEs: 'prueba',
    contentEsMt: false,
    contentRating: ContentRating.SAFE,
    storage: SegmentStorage.R2,
    hashedId: `hash-${segIdx}`,
    episode,
    mediaId,
    storageBasePath: '/test',
  });
}

describe('badSegmentRatio check', () => {
  it('flags episodes with bad segment ratio above threshold', async () => {
    const media = createMedia({ nameRomaji: 'Bad Ratio Show' });
    await media.save();
    await Episode.create({ mediaId: media.id, episodeNumber: 1 }).save();

    // 2 ACTIVE, 3 PENDING (bad) = 60% bad
    await createSegment(media.id, 1, SegmentStatus.ACTIVE).save();
    await createSegment(media.id, 1, SegmentStatus.ACTIVE).save();
    await createSegment(media.id, 1, SegmentStatus.SUSPENDED).save();
    await createSegment(media.id, 1, SegmentStatus.SUSPENDED).save();
    await createSegment(media.id, 1, SegmentStatus.SUSPENDED).save();

    const results = await badSegmentRatio.run({
      threshold: { maxBadRatio: 0.2 },
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      targetType: 'EPISODE',
      mediaId: media.id,
      episodeNumber: 1,
    });
    expect(results[0].data.badRatio).toBe(0.6);
    expect(results[0].description).toContain('Bad Ratio Show EP1');
  });

  it('does not flag episodes below the threshold', async () => {
    const media = createMedia();
    await media.save();
    await Episode.create({ mediaId: media.id, episodeNumber: 1 }).save();

    // All ACTIVE = 0% bad
    await createSegment(media.id, 1, SegmentStatus.ACTIVE).save();
    await createSegment(media.id, 1, SegmentStatus.ACTIVE).save();

    const results = await badSegmentRatio.run({
      threshold: { maxBadRatio: 0.2 },
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(0);
  });

  it('treats VERIFIED segments as good', async () => {
    const media = createMedia();
    await media.save();
    await Episode.create({ mediaId: media.id, episodeNumber: 1 }).save();

    // 1 ACTIVE, 1 VERIFIED = 0% bad
    await createSegment(media.id, 1, SegmentStatus.ACTIVE).save();
    await createSegment(media.id, 1, SegmentStatus.VERIFIED).save();

    const results = await badSegmentRatio.run({
      threshold: { maxBadRatio: 0.2 },
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(0);
  });

  it('excludes DELETED segments from counting', async () => {
    const media = createMedia();
    await media.save();
    await Episode.create({ mediaId: media.id, episodeNumber: 1 }).save();

    await createSegment(media.id, 1, SegmentStatus.ACTIVE).save();
    await createSegment(media.id, 1, SegmentStatus.DELETED).save();

    const results = await badSegmentRatio.run({
      threshold: { maxBadRatio: 0.2 },
      dataSource: TestDataSource,
    });

    // Only 1 ACTIVE counted, 0 bad → 0% bad
    expect(results).toHaveLength(0);
  });

  it('filters by category', async () => {
    const anime = createMedia({ nameRomaji: 'Anime' });
    await anime.save();
    await Episode.create({ mediaId: anime.id, episodeNumber: 1 }).save();
    await createSegment(anime.id, 1, SegmentStatus.SUSPENDED).save();

    const drama = createMedia({ nameRomaji: 'Drama', category: CategoryType.JDRAMA });
    await drama.save();
    await Episode.create({ mediaId: drama.id, episodeNumber: 1 }).save();
    await createSegment(drama.id, 1, SegmentStatus.SUSPENDED).save();

    const results = await badSegmentRatio.run({
      threshold: { maxBadRatio: 0.2 },
      category: CategoryType.JDRAMA,
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(1);
    expect(results[0].mediaId).toBe(drama.id);
  });
});
