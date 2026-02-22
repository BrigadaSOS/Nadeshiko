import { AppDataSource } from '@config/database';
import { client as esClient } from '@config/elasticsearch';
import type { DataSource } from 'typeorm';
import type { Client } from '@elastic/elasticsearch';
import {
  Report,
  ReportSource,
  ReportTargetType,
  ReportStatus,
  ReportReason,
} from '@app/models';
import { MediaAudit } from './MediaAudit';
import { MediaAuditRun } from './MediaAuditRun';
import { MediaAuditTargetType } from './MediaAudit';
import { auditRegistry, type MediaAuditCheck, type CheckResult } from './checks';
import { logger } from '@config/log';

interface RunAuditSummary {
  auditName: string;
  label: string;
  resultCount: number;
  runId: number;
}

interface RunResult {
  category?: string;
  checksRun: RunAuditSummary[];
  totalReports: number;
}

export interface AuditDeps {
  dataSource: DataSource;
  esClient?: Client;
}

export const AUDIT_NAME_TO_REASON: Record<string, ReportReason> = {
  lowSegmentMedia: ReportReason.LOW_SEGMENT_MEDIA,
  emptyEpisodes: ReportReason.EMPTY_EPISODES,
  missingEpisodes: ReportReason.MISSING_EPISODES_AUTO,
  badSegmentRatio: ReportReason.BAD_SEGMENT_RATIO,
  mediaWithNoEpisodes: ReportReason.MEDIA_WITH_NO_EPISODES,
  missingTranslations: ReportReason.MISSING_TRANSLATIONS,
  dbEsSyncIssues: ReportReason.DB_ES_SYNC_ISSUES,
  highReportDensity: ReportReason.HIGH_REPORT_DENSITY,
};

export async function runAllAudits(category?: string, auditName?: string): Promise<RunResult> {
  return runAllAuditsWithDeps({ dataSource: AppDataSource, esClient }, category, auditName);
}

export async function runAllAuditsWithDeps(
  deps: AuditDeps,
  category?: string,
  auditName?: string,
): Promise<RunResult> {
  const enabledAudits = await getEnabledAudits();
  const auditsToRun = auditName ? enabledAudits.filter((c) => c.name === auditName) : enabledAudits;

  const checksRun: RunAuditSummary[] = [];
  let totalReports = 0;

  for (const audit of auditsToRun) {
    try {
      const summary = await runSingleAudit(audit, deps, category);
      checksRun.push(summary);
      totalReports += summary.resultCount;
    } catch (error) {
      logger.error({ error, auditName: audit.name }, 'Audit execution failed');
    }
  }

  return { category, checksRun, totalReports };
}

async function getEnabledAudits(): Promise<MediaAuditCheck[]> {
  const dbAudits = await MediaAudit.find({ where: { enabled: true } });
  const enabledNames = new Set(dbAudits.map((c) => c.name));

  return auditRegistry.filter((audit) => enabledNames.has(audit.name));
}

export async function getPreviousRunData(
  auditName: string,
  category?: string,
): Promise<Map<string, Record<string, unknown>> | undefined> {
  const previousRun = await MediaAuditRun.findOne({
    where: { auditName, ...(category ? { category } : {}) },
    order: { createdAt: 'DESC' },
  });

  if (!previousRun) return undefined;

  const prevReports = await Report.find({
    where: { auditRunId: previousRun.id },
  });

  return new Map(
    prevReports.map((r) => [`${r.targetMediaId}:${r.targetEpisodeNumber ?? ''}`, r.data ?? {}]),
  );
}

export function enrichResults(
  results: CheckResult[],
  previousReports?: Map<string, Record<string, unknown>>,
  userReportCounts?: Map<string, number>,
): { key: string; data: Record<string, unknown>; result: CheckResult }[] {
  return results.map((result) => {
    const key = `${result.mediaId}:${result.episodeNumber ?? ''}`;
    const data: Record<string, unknown> = { ...result.data };

    if (previousReports?.has(key)) {
      data.previousData = previousReports.get(key);
    }

    const userCount = userReportCounts?.get(key) ?? 0;
    if (userCount > 0) {
      data.userReportCount = userCount;
    }

    return { key, data, result };
  });
}

export function buildReports(
  enrichedResults: { data: Record<string, unknown>; result: CheckResult }[],
  runId: number,
  auditName: string,
): Report[] {
  const reason = AUDIT_NAME_TO_REASON[auditName] ?? ReportReason.OTHER;

  return enrichedResults.map(({ data, result }) => {
    const report = new Report();
    report.source = ReportSource.AUTO;
    report.targetType = result.targetType === 'MEDIA' ? ReportTargetType.MEDIA : ReportTargetType.EPISODE;
    report.targetMediaId = result.mediaId;
    report.targetEpisodeNumber = result.episodeNumber ?? null;
    report.auditRunId = runId;
    report.reason = reason;
    report.description = result.description;
    report.data = data;
    report.status = ReportStatus.PENDING;
    return report;
  });
}

async function runSingleAudit(
  audit: MediaAuditCheck,
  deps: AuditDeps,
  category?: string,
): Promise<RunAuditSummary> {
  const dbAudit = await MediaAudit.findOne({ where: { name: audit.name } });
  if (!dbAudit) {
    throw new Error(`Audit config not found in DB: ${audit.name}`);
  }

  const threshold = dbAudit.threshold;

  const [previousReports, results, userReportCounts] = await Promise.all([
    getPreviousRunData(audit.name, category),
    audit.run({ threshold, category, dataSource: deps.dataSource, esClient: deps.esClient }),
    getUserReportCounts(),
  ]);

  const run = MediaAuditRun.create({
    auditName: audit.name,
    category: category ?? null,
    resultCount: results.length,
    thresholdUsed: threshold,
  });
  await run.save();

  const enriched = enrichResults(results, previousReports, userReportCounts);
  const reports = buildReports(enriched, run.id, audit.name);

  if (reports.length > 0) {
    await Report.save(reports as Report[]);
  }

  return {
    auditName: audit.name,
    label: audit.label,
    resultCount: results.length,
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

export async function seedAuditConfigs(): Promise<void> {
  for (const audit of auditRegistry) {
    const existing = await MediaAudit.findOne({ where: { name: audit.name } });
    if (!existing) {
      const defaults: Record<string, number | boolean> = {};
      for (const field of audit.thresholdSchema) {
        defaults[field.key] = field.default;
      }
      const newAudit = new MediaAudit();
      newAudit.name = audit.name;
      newAudit.label = audit.label;
      newAudit.description = audit.description;
      newAudit.targetType = audit.targetType as MediaAuditTargetType;
      newAudit.threshold = defaults;
      newAudit.enabled = true;
      await newAudit.save();
      logger.info({ auditName: audit.name }, 'Seeded media audit config');
    }
  }
}
