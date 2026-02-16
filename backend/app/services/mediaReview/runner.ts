import { AppDataSource } from '@config/database';
import { client as esClient } from '@app/services/elasticsearch';
import {
  Report,
  ReportSource,
  ReportTargetType,
  ReportStatus,
  ReportReason,
  ReviewCheck,
  ReviewCheckTargetType,
  ReviewCheckRun,
  ReviewAllowlist,
} from '@app/models';
import { checkRegistry, type MediaReviewCheck } from './registry';
import { logger } from '@config/log';

interface RunCheckSummary {
  checkName: string;
  label: string;
  resultCount: number;
  runId: number;
}

interface RunResult {
  category?: string;
  checksRun: RunCheckSummary[];
  totalReports: number;
}

const CHECK_NAME_TO_REASON: Record<string, ReportReason> = {
  lowSegmentMedia: ReportReason.LOW_SEGMENT_MEDIA,
  emptyEpisodes: ReportReason.EMPTY_EPISODES,
  missingEpisodes: ReportReason.MISSING_EPISODES_AUTO,
  badSegmentRatio: ReportReason.BAD_SEGMENT_RATIO,
  mediaWithNoEpisodes: ReportReason.MEDIA_WITH_NO_EPISODES,
  missingTranslations: ReportReason.MISSING_TRANSLATIONS,
  dbEsSyncIssues: ReportReason.DB_ES_SYNC_ISSUES,
  highReportDensity: ReportReason.HIGH_REPORT_DENSITY,
};

export async function runAllChecks(category?: string, checkName?: string): Promise<RunResult> {
  const enabledChecks = await getEnabledChecks();
  const checksToRun = checkName ? enabledChecks.filter((c) => c.name === checkName) : enabledChecks;

  const checksRun: RunCheckSummary[] = [];
  let totalReports = 0;

  for (const check of checksToRun) {
    try {
      const summary = await runSingleCheck(check, category);
      checksRun.push(summary);
      totalReports += summary.resultCount;
    } catch (error) {
      logger.error({ error, checkName: check.name }, 'Check execution failed');
    }
  }

  return { category, checksRun, totalReports };
}

async function getEnabledChecks(): Promise<MediaReviewCheck[]> {
  const dbChecks = await ReviewCheck.find({ where: { enabled: true } });
  const enabledNames = new Set(dbChecks.map((c) => c.name));

  return checkRegistry.filter((check) => enabledNames.has(check.name));
}

async function runSingleCheck(check: MediaReviewCheck, category?: string): Promise<RunCheckSummary> {
  const dbCheck = await ReviewCheck.findOne({ where: { name: check.name } });
  if (!dbCheck) {
    throw new Error(`Check config not found in DB: ${check.name}`);
  }

  const threshold = dbCheck.threshold;

  // Load allowlist for this check
  const allowlistEntries = await ReviewAllowlist.find({ where: { checkName: check.name } });
  const allowlistSet = new Set(allowlistEntries.map((a) => `${a.mediaId}:${a.episodeNumber ?? ''}`));

  // Find previous run for trend detection
  const previousRun = await ReviewCheckRun.findOne({
    where: { checkName: check.name, ...(category ? { category } : {}) },
    order: { createdAt: 'DESC' },
  });

  let previousReports: Map<string, Record<string, unknown>> | undefined;
  if (previousRun) {
    const prevReports = await Report.find({
      where: { reviewCheckRunId: previousRun.id },
    });
    previousReports = new Map(
      prevReports.map((r) => [`${r.targetMediaId}:${r.targetEpisodeNumber ?? ''}`, r.data ?? {}]),
    );
  }

  // Execute the check
  const results = await check.run({
    threshold,
    category,
    dataSource: AppDataSource,
    esClient,
  });

  // Filter out allowlisted results
  const filtered = results.filter((r) => !allowlistSet.has(`${r.mediaId}:${r.episodeNumber ?? ''}`));

  // Enrich with user report counts
  const userReportCounts = await getUserReportCounts();

  // Create run record
  const run = ReviewCheckRun.create({
    checkName: check.name,
    category: category ?? null,
    resultCount: filtered.length,
    thresholdUsed: threshold,
  });
  await run.save();

  // Create reports
  const reason = CHECK_NAME_TO_REASON[check.name] ?? ReportReason.OTHER;
  const reports: Report[] = [];

  for (const result of filtered) {
    const key = `${result.mediaId}:${result.episodeNumber ?? ''}`;
    const data: Record<string, unknown> = { ...result.data };

    // Add trend data from previous run
    if (previousReports?.has(key)) {
      data.previousData = previousReports.get(key);
    }

    // Add user report count enrichment
    const userCount = userReportCounts.get(key) ?? 0;
    if (userCount > 0) {
      data.userReportCount = userCount;
    }

    const report = new Report();
    report.source = ReportSource.AUTO;
    report.targetType = result.targetType === 'MEDIA' ? ReportTargetType.MEDIA : ReportTargetType.EPISODE;
    report.targetMediaId = result.mediaId;
    report.targetEpisodeNumber = result.episodeNumber ?? null;
    report.reviewCheckRunId = run.id;
    report.reason = reason;
    report.description = result.description;
    report.data = data;
    report.status = ReportStatus.PENDING;
    reports.push(report);
  }

  if (reports.length > 0) {
    await Report.save(reports as Report[]);
  }

  return {
    checkName: check.name,
    label: check.label,
    resultCount: filtered.length,
    runId: run.id,
  };
}

async function getUserReportCounts(): Promise<Map<string, number>> {
  const rows = await Report.createQueryBuilder('r')
    .select('r.target_media_id', 'targetMediaId')
    .addSelect('r.target_episode_number', 'targetEpisodeNumber')
    .addSelect('COUNT(*)', 'count')
    .where('r.source = :source', { source: 'USER' })
    .andWhere('r.status IN (:...statuses)', { statuses: ['PENDING', 'ACCEPTED'] })
    .groupBy('r.target_media_id')
    .addGroupBy('r.target_episode_number')
    .getRawMany();

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(`${row.targetMediaId}:${row.targetEpisodeNumber ?? ''}`, Number(row.count));
  }
  return map;
}

export async function seedCheckConfigs(): Promise<void> {
  for (const check of checkRegistry) {
    const existing = await ReviewCheck.findOne({ where: { name: check.name } });
    if (!existing) {
      const defaults: Record<string, number | boolean> = {};
      for (const field of check.thresholdSchema) {
        defaults[field.key] = field.default;
      }
      const newCheck = new ReviewCheck();
      newCheck.name = check.name;
      newCheck.label = check.label;
      newCheck.description = check.description;
      newCheck.targetType = check.targetType as ReviewCheckTargetType;
      newCheck.threshold = defaults;
      newCheck.enabled = true;
      await newCheck.save();
      logger.info({ checkName: check.name }, 'Seeded review check config');
    }
  }
}
