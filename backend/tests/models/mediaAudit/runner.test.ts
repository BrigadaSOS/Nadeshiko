import { describe, it, expect, beforeEach } from 'bun:test';
import { setupTestSuite, TestDataSource } from '../../helpers/setup';
import {
  Media,
  Episode,
  Report,
  ReportSource,
  ReportTargetType,
  ReportStatus,
  ReportReason,
  CategoryType,
  SegmentStorage,
  MediaAudit,
  MediaAuditRun,
} from '@app/models';
import { MediaAuditTargetType } from '@app/models/mediaAudit/MediaAudit';
import {
  enrichResults,
  buildReports,
  getPreviousRunData,
  AUDIT_NAME_TO_REASON,
  runAllAuditsWithDeps,
} from '@app/models/mediaAudit/runner';
import type { CheckResult } from '@app/models/mediaAudit/checks';

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

describe('enrichResults', () => {
  it('returns enriched entries with keys and data', () => {
    const results: CheckResult[] = [{ targetType: 'MEDIA', mediaId: 1, data: { foo: 'bar' }, description: 'test' }];

    const enriched = enrichResults(results);

    expect(enriched).toHaveLength(1);
    expect(enriched[0].key).toBe('1:');
    expect(enriched[0].data).toEqual({ foo: 'bar' });
  });

  it('adds previousData when key matches', () => {
    const results: CheckResult[] = [{ targetType: 'MEDIA', mediaId: 1, data: { count: 5 }, description: 'test' }];
    const previousReports = new Map([['1:', { count: 3 }]]);

    const enriched = enrichResults(results, previousReports);

    expect(enriched[0].data).toEqual({ count: 5, previousData: { count: 3 } });
  });

  it('does not add previousData when key does not match', () => {
    const results: CheckResult[] = [{ targetType: 'MEDIA', mediaId: 1, data: { count: 5 }, description: 'test' }];
    const previousReports = new Map([['2:', { count: 3 }]]);

    const enriched = enrichResults(results, previousReports);

    expect(enriched[0].data).toEqual({ count: 5 });
  });

  it('adds userReportCount when > 0', () => {
    const results: CheckResult[] = [{ targetType: 'MEDIA', mediaId: 1, data: {}, description: 'test' }];
    const userReportCounts = new Map([['1:', 7]]);

    const enriched = enrichResults(results, undefined, userReportCounts);

    expect(enriched[0].data).toEqual({ userReportCount: 7 });
  });

  it('omits userReportCount when 0', () => {
    const results: CheckResult[] = [{ targetType: 'MEDIA', mediaId: 1, data: {}, description: 'test' }];
    const userReportCounts = new Map([['1:', 0]]);

    const enriched = enrichResults(results, undefined, userReportCounts);

    expect(enriched[0].data).toEqual({});
  });

  it('builds key with episodeNumber for episode targets', () => {
    const results: CheckResult[] = [
      { targetType: 'EPISODE', mediaId: 1, episodeNumber: 5, data: {}, description: 'test' },
    ];

    const enriched = enrichResults(results);

    expect(enriched[0].key).toBe('1:5');
  });
});

describe('buildReports', () => {
  it('creates Report entities with correct fields', () => {
    const enriched = [
      {
        data: { count: 5 },
        result: { targetType: 'MEDIA' as const, mediaId: 10, data: {}, description: 'test desc' },
      },
    ];

    const reports = buildReports(enriched, 99, 'lowSegmentEpisodes');

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      source: ReportSource.AUTO,
      targetType: ReportTargetType.MEDIA,
      targetMediaId: 10,
      targetEpisodeNumber: null,
      auditRunId: 99,
      reason: ReportReason.EMPTY_EPISODES,
      description: 'test desc',
      data: { count: 5 },
      status: ReportStatus.PENDING,
    });
  });

  it('maps EPISODE targetType correctly', () => {
    const enriched = [
      {
        data: {},
        result: { targetType: 'EPISODE' as const, mediaId: 1, episodeNumber: 3, data: {}, description: 'ep' },
      },
    ];

    const reports = buildReports(enriched, 1, 'missingEpisodes');

    expect(reports[0].targetType).toBe(ReportTargetType.EPISODE);
    expect(reports[0].targetEpisodeNumber).toBe(3);
    expect(reports[0].reason).toBe(ReportReason.MISSING_EPISODES_AUTO);
  });

  it('falls back to OTHER for unknown audit names', () => {
    const enriched = [{ data: {}, result: { targetType: 'MEDIA' as const, mediaId: 1, data: {}, description: 'x' } }];

    const reports = buildReports(enriched, 1, 'unknownCheck');

    expect(reports[0].reason).toBe(ReportReason.OTHER);
  });

  it('maps all known audit names to reasons', () => {
    for (const [auditName, reason] of Object.entries(AUDIT_NAME_TO_REASON)) {
      const enriched = [{ data: {}, result: { targetType: 'MEDIA' as const, mediaId: 1, data: {}, description: '' } }];
      const reports = buildReports(enriched, 1, auditName);
      expect(reports[0].reason).toBe(reason);
    }
  });
});

describe('getPreviousRunData', () => {
  it('returns undefined when no previous run exists', async () => {
    const result = await getPreviousRunData('nonexistent');
    expect(result).toBeUndefined();
  });

  it('returns a map of previous report data keyed by target', async () => {
    const media = createMedia();
    await media.save();

    const run = MediaAuditRun.create({
      auditName: 'lowSegmentEpisodes',
      category: null,
      resultCount: 1,
      thresholdUsed: { minSegments: 10 },
    });
    await run.save();

    const report = new Report();
    report.source = ReportSource.AUTO;
    report.targetType = ReportTargetType.EPISODE;
    report.targetMediaId = media.id;
    report.targetEpisodeNumber = 3;
    report.auditRunId = run.id;
    report.reason = ReportReason.EMPTY_EPISODES;
    report.data = { segmentCount: 2 };
    report.status = ReportStatus.PENDING;
    await report.save();

    const result = await getPreviousRunData('lowSegmentEpisodes');

    expect(result).toBeDefined();
    expect(result?.get(`${media.id}:3`)).toEqual({ segmentCount: 2 });
  });

  it('filters by category when provided', async () => {
    const run1 = MediaAuditRun.create({
      auditName: 'lowSegmentEpisodes',
      category: 'ANIME',
      resultCount: 0,
      thresholdUsed: {},
    });
    await run1.save();

    const run2 = MediaAuditRun.create({
      auditName: 'lowSegmentEpisodes',
      category: 'JDRAMA',
      resultCount: 0,
      thresholdUsed: {},
    });
    await run2.save();

    const result = await getPreviousRunData('lowSegmentEpisodes', 'JDRAMA');

    expect(result).toBeDefined();
    expect(result?.size).toBe(0);
  });
});

describe('runAllAuditsWithDeps', () => {
  beforeEach(async () => {
    const audit = new MediaAudit();
    audit.name = 'lowSegmentEpisodes';
    audit.label = 'Low Segment Episodes';
    audit.description = 'Episodes with segment count below threshold';
    audit.targetType = MediaAuditTargetType.EPISODE;
    audit.threshold = { minSegments: 10 };
    audit.enabled = true;
    await audit.save();
  });

  it('runs enabled audits and creates run + reports', async () => {
    const media = createMedia();
    await media.save();
    await Episode.create({ mediaId: media.id, episodeNumber: 1, segmentCount: 2 }).save();

    const result = await runAllAuditsWithDeps({ dataSource: TestDataSource }, undefined, 'lowSegmentEpisodes');

    expect(result.checksRun).toHaveLength(1);
    expect(result.checksRun[0].auditName).toBe('lowSegmentEpisodes');
    expect(result.checksRun[0].resultCount).toBe(1);
    expect(result.totalReports).toBe(1);

    const run = await MediaAuditRun.findOne({ where: { id: result.checksRun[0].runId } });
    expect(run).toBeDefined();
    expect(run?.auditName).toBe('lowSegmentEpisodes');
    expect(run?.resultCount).toBe(1);

    const reports = await Report.find({ where: { auditRunId: run?.id } });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      source: ReportSource.AUTO,
      targetType: ReportTargetType.EPISODE,
      targetMediaId: media.id,
      targetEpisodeNumber: 1,
      reason: ReportReason.EMPTY_EPISODES,
      status: ReportStatus.PENDING,
    });
  });

  it('filters by category', async () => {
    const anime = createMedia({ nameRomaji: 'Anime' });
    await anime.save();
    await Episode.create({ mediaId: anime.id, episodeNumber: 1, segmentCount: 2 }).save();

    const drama = createMedia({ nameRomaji: 'Drama', category: CategoryType.JDRAMA });
    await drama.save();
    await Episode.create({ mediaId: drama.id, episodeNumber: 1, segmentCount: 2 }).save();

    const result = await runAllAuditsWithDeps(
      { dataSource: TestDataSource },
      CategoryType.JDRAMA,
      'lowSegmentEpisodes',
    );

    expect(result.category).toBe(CategoryType.JDRAMA);
    expect(result.checksRun[0].resultCount).toBe(1);

    const reports = await Report.find({ where: { auditRunId: result.checksRun[0].runId } });
    expect(reports[0].targetMediaId).toBe(drama.id);
  });

  it('returns empty checksRun when no audits match the name', async () => {
    const result = await runAllAuditsWithDeps({ dataSource: TestDataSource }, undefined, 'nonexistentAudit');

    expect(result.checksRun).toHaveLength(0);
    expect(result.totalReports).toBe(0);
  });

  it('creates no reports when check finds no issues', async () => {
    const media = createMedia();
    await media.save();
    await Episode.create({ mediaId: media.id, episodeNumber: 1, segmentCount: 100 }).save();

    const result = await runAllAuditsWithDeps({ dataSource: TestDataSource }, undefined, 'lowSegmentEpisodes');

    expect(result.checksRun[0].resultCount).toBe(0);
    const run = await MediaAuditRun.findOne({ where: { id: result.checksRun[0].runId } });
    const reports = await Report.find({ where: { auditRunId: run?.id } });
    expect(reports).toHaveLength(0);
  });
});
