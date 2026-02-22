import { describe, it, expect } from 'bun:test';
import { setupTestSuite, TestDataSource } from '../../../helpers/setup';
import {
  Media,
  Report,
  ReportSource,
  ReportTargetType,
  ReportReason,
  ReportStatus,
  CategoryType,
  SegmentStorage,
} from '@app/models';
import { highReportDensity } from '@app/models/mediaAudit/checks/highReportDensity';

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

function createUserReport(mediaId: number, status = ReportStatus.PENDING) {
  const report = new Report();
  report.source = ReportSource.USER;
  report.targetType = ReportTargetType.MEDIA;
  report.targetMediaId = mediaId;
  report.reason = ReportReason.OTHER;
  report.status = status;
  return report;
}

describe('highReportDensity check', () => {
  it('flags media with report count at or above threshold', async () => {
    const media = createMedia({ nameRomaji: 'Reported Show' });
    await media.save();

    await createUserReport(media.id).save();
    await createUserReport(media.id).save();
    await createUserReport(media.id).save();

    const results = await highReportDensity.run({
      threshold: { minReportCount: 3 },
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      targetType: 'MEDIA',
      mediaId: media.id,
    });
    expect(results[0].data.reportCount).toBe(3);
    expect(results[0].description).toContain('Reported Show');
  });

  it('does not flag media below the threshold', async () => {
    const media = createMedia();
    await media.save();

    await createUserReport(media.id).save();

    const results = await highReportDensity.run({
      threshold: { minReportCount: 3 },
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(0);
  });

  it('only counts USER reports, not AUTO', async () => {
    const media = createMedia();
    await media.save();

    await createUserReport(media.id).save();

    const autoReport = new Report();
    autoReport.source = ReportSource.AUTO;
    autoReport.targetType = ReportTargetType.MEDIA;
    autoReport.targetMediaId = media.id;
    autoReport.reason = ReportReason.OTHER;
    autoReport.status = ReportStatus.PENDING;
    await autoReport.save();

    const results = await highReportDensity.run({
      threshold: { minReportCount: 2 },
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(0);
  });

  it('tracks pending count separately', async () => {
    const media = createMedia();
    await media.save();

    await createUserReport(media.id, ReportStatus.PENDING).save();
    await createUserReport(media.id, ReportStatus.PENDING).save();
    await createUserReport(media.id, ReportStatus.RESOLVED).save();

    const results = await highReportDensity.run({
      threshold: { minReportCount: 3 },
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(1);
    expect(results[0].data.pendingCount).toBe(2);
    expect(results[0].data.reportCount).toBe(3);
  });

  it('filters by category', async () => {
    const anime = createMedia({ nameRomaji: 'Anime' });
    await anime.save();
    await createUserReport(anime.id).save();
    await createUserReport(anime.id).save();

    const drama = createMedia({ nameRomaji: 'Drama', category: CategoryType.JDRAMA });
    await drama.save();
    await createUserReport(drama.id).save();
    await createUserReport(drama.id).save();

    const results = await highReportDensity.run({
      threshold: { minReportCount: 2 },
      category: CategoryType.JDRAMA,
      dataSource: TestDataSource,
    });

    expect(results).toHaveLength(1);
    expect(results[0].mediaId).toBe(drama.id);
  });
});
