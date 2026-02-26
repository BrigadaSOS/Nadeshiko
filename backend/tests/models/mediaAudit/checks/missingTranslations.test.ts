import { describe, it, expect } from 'bun:test';
import { setupTestSuite, TestDataSource } from '../../../helpers/setup';
import { Media, Episode, Segment, CategoryType, SegmentStorage, SegmentStatus, ContentRating } from '@app/models';
import { missingTranslations } from '@app/models/mediaAudit/checks/missingTranslations';

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

function createSegment(mediaId: number, episode: number, overrides: Partial<Segment> = {}) {
  segIdx++;
  return Segment.create({
    uuid: `test-trans-${segIdx}`,
    position: segIdx,
    status: SegmentStatus.ACTIVE,
    startTimeMs: 0,
    endTimeMs: 5000,
    contentJa: 'テスト',
    contentEn: 'test',
    contentEnMt: false,
    contentEs: 'prueba',
    contentEsMt: false,
    contentRating: ContentRating.SAFE,
    storage: SegmentStorage.R2,
    hashedId: `hash-trans-${segIdx}`,
    episode,
    mediaId,
    storageBasePath: '/test',
    ...overrides,
  });
}

describe('missingTranslations check', () => {
  it('flags episodes with segments missing English translations', async () => {
    const media = createMedia({ nameRomaji: 'No EN Show' });
    await media.save();
    await Episode.create({ mediaId: media.id, episodeNumber: 1 }).save();

    await createSegment(media.id, 1, { contentEn: '' }).save();
    await createSegment(media.id, 1, { contentEn: 'has translation' }).save();

    const results = await missingTranslations.run({
      threshold: { minMissingCount: 1 },
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      targetType: 'EPISODE',
      mediaId: media.id,
      episodeNumber: 1,
    });
    expect(results[0].data.missingEnCount).toBe(1);
    expect(results[0].data.totalCount).toBe(2);
    expect(results[0].description).toContain('No EN Show EP1');
  });

  it('returns empty when all segments have translations', async () => {
    const media = createMedia();
    await media.save();
    await Episode.create({ mediaId: media.id, episodeNumber: 1 }).save();

    await createSegment(media.id, 1, { contentEn: 'translated' }).save();

    const results = await missingTranslations.run({
      threshold: { minMissingCount: 1 },
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(0);
  });

  it('respects minMissingCount threshold', async () => {
    const media = createMedia();
    await media.save();
    await Episode.create({ mediaId: media.id, episodeNumber: 1 }).save();

    // Only 1 missing, threshold is 3
    await createSegment(media.id, 1, { contentEn: '' }).save();
    await createSegment(media.id, 1, { contentEn: 'ok' }).save();

    const results = await missingTranslations.run({
      threshold: { minMissingCount: 3 },
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(0);
  });

  it('only counts ACTIVE segments', async () => {
    const media = createMedia();
    await media.save();
    await Episode.create({ mediaId: media.id, episodeNumber: 1 }).save();

    // SUSPENDED segment with missing EN should be ignored
    await createSegment(media.id, 1, { contentEn: '', status: SegmentStatus.SUSPENDED }).save();
    await createSegment(media.id, 1, { contentEn: 'ok' }).save();

    const results = await missingTranslations.run({
      threshold: { minMissingCount: 1 },
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(0);
  });

  it('filters by category', async () => {
    const anime = createMedia({ nameRomaji: 'Anime' });
    await anime.save();
    await Episode.create({ mediaId: anime.id, episodeNumber: 1 }).save();
    await createSegment(anime.id, 1, { contentEn: '' }).save();

    const drama = createMedia({ nameRomaji: 'Drama', category: CategoryType.JDRAMA });
    await drama.save();
    await Episode.create({ mediaId: drama.id, episodeNumber: 1 }).save();
    await createSegment(drama.id, 1, { contentEn: '' }).save();

    const results = await missingTranslations.run({
      threshold: { minMissingCount: 1 },
      category: CategoryType.JDRAMA,
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(1);
    expect(results[0].mediaId).toBe(drama.id);
  });
});
