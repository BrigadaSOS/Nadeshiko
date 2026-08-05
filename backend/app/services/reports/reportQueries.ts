import { Media, Report, ReportSource, ReportTargetType } from '@app/models';
import { type AdminReportFilters, parseStatusFilter, toTargetGroupKey } from '@app/controllers/mappers/reportMapper';
import type { EntityManager } from 'typeorm';
import { InvalidRequestError } from '@app/errors';

/**
 * Query building for admin report screens.
 *
 * Reports are stored per-user but administered per *target group* -- the
 * (targetType, mediaId, episodeNumber, segmentId) tuple that several users may
 * each have reported. Almost everything here exists to express "the same target"
 * in SQL, which is fiddly because two of the four columns are nullable and
 * `= NULL` silently matches nothing.
 */

/** The minimum surface of a TypeORM query builder these helpers need. */
type Filterable = {
  andWhere(where: string, params?: Record<string, unknown>): unknown;
};

/**
 * The predicate identifying a single target group.
 *
 * Returned as SQL rather than applied directly because callers need it two ways:
 * AND-ed onto an update/delete that targets one group, and OR-ed together across
 * many groups when fetching members. Building it once keeps those from drifting --
 * they were previously two separate implementations of the same composite key,
 * and only one of them handled the nullable columns via `IS NULL`.
 */
function targetGroupPredicate(
  alias: string,
  report: Report,
  prefix: string,
): { sql: string; params: Record<string, unknown> } {
  const params: Record<string, unknown> = {
    [`${prefix}_tt`]: report.targetType,
    [`${prefix}_mid`]: report.targetMediaId,
  };

  const clauses = [`${alias}.target_type = :${prefix}_tt`, `${alias}.target_media_id = :${prefix}_mid`];

  // `= NULL` is never true in SQL, so a null column has to be matched with IS NULL
  // or a media-level group would match no rows at all.
  if (report.targetEpisodeNumber != null) {
    clauses.push(`${alias}.target_episode_number = :${prefix}_ep`);
    params[`${prefix}_ep`] = report.targetEpisodeNumber;
  } else {
    clauses.push(`${alias}.target_episode_number IS NULL`);
  }

  if (report.targetSegmentId != null) {
    clauses.push(`${alias}.target_segment_id = :${prefix}_sid`);
    params[`${prefix}_sid`] = report.targetSegmentId;
  } else {
    clauses.push(`${alias}.target_segment_id IS NULL`);
  }

  return { sql: `(${clauses.join(' AND ')})`, params };
}

/** Restricts a query to the one target group `report` belongs to. */
function applyTargetGroupWhere(qb: Filterable, alias: string, report: Report, prefix: string): void {
  const { sql, params } = targetGroupPredicate(alias, report, prefix);
  qb.andWhere(sql, params);
}

/** Applies the admin list/bulk filter set. `paramPrefix` keeps names unique when a query embeds a subquery. */
export function applyReportFilters(
  qb: Filterable,
  alias: string,
  filters: AdminReportFilters,
  paramPrefix?: string,
): void {
  const p = paramPrefix ?? alias;

  if (filters.statuses) {
    qb.andWhere(`${alias}.status IN (:...${p}_statuses)`, { [`${p}_statuses`]: filters.statuses });
  }
  if (filters.source) {
    qb.andWhere(`${alias}.source = :${p}_source`, { [`${p}_source`]: filters.source });
  }
  if (filters.targetType) {
    qb.andWhere(`${alias}.target_type = :${p}_targetType`, { [`${p}_targetType`]: filters.targetType });
  }
  if (filters.targetMediaId !== undefined) {
    qb.andWhere(`${alias}.target_media_id = :${p}_targetMediaId`, { [`${p}_targetMediaId`]: filters.targetMediaId });
  }
  if (filters.targetEpisodeNumber !== undefined) {
    qb.andWhere(`${alias}.target_episode_number = :${p}_targetEpisodeNumber`, {
      [`${p}_targetEpisodeNumber`]: filters.targetEpisodeNumber,
    });
  }
  if (filters.targetSegmentId !== undefined) {
    qb.andWhere(`${alias}.target_segment_id = :${p}_targetSegmentId`, {
      [`${p}_targetSegmentId`]: filters.targetSegmentId,
    });
  }
  if (filters.auditRunId !== undefined) {
    qb.andWhere(`${alias}.audit_run_id = :${p}_auditRunId`, { [`${p}_auditRunId`]: filters.auditRunId });
  }
  if (filters.orphaned) {
    qb.andWhere(`${alias}.target_media_id NOT IN (${Media.createQueryBuilder('m').select('m.id').getQuery()})`);
  }
}

/** One representative row per target group, paginated -- the admin list is a list of groups, not reports. */
export function buildGroupRepresentativesQuery(filters: AdminReportFilters) {
  const qb = Report.createQueryBuilder('report');
  applyReportFilters(qb, 'report', filters);

  const dedup = Report.createQueryBuilder('dedup')
    .select('MAX(dedup.id)', 'max_id')
    .groupBy('dedup.target_type')
    .addGroupBy('dedup.target_media_id')
    .addGroupBy('dedup.target_episode_number')
    .addGroupBy('dedup.target_segment_id');
  applyReportFilters(dedup, 'dedup', filters);

  qb.andWhere(`report.id IN (${dedup.getQuery()})`, dedup.getParameters());
  return qb;
}

/** Every report belonging to any of `groupReps`' target groups. */
export async function fetchGroupMembers(groupReps: Report[], filters: AdminReportFilters): Promise<Report[]> {
  if (groupReps.length === 0) return [];

  const qb = Report.createQueryBuilder('r').leftJoinAndSelect('r.user', 'u').orderBy('r.created_at', 'DESC');
  applyReportFilters(qb, 'r', filters);

  const predicates = groupReps.map((rep, i) => targetGroupPredicate('r', rep, `g${i}`));
  const sql = predicates.map((p) => p.sql).join(' OR ');
  const params = Object.assign({}, ...predicates.map((p) => p.params));

  qb.andWhere(`(${sql})`, params);
  return qb.getMany();
}

export async function updateReportGroup(
  report: Report,
  patch: Record<string, unknown>,
  manager: EntityManager,
): Promise<number> {
  const qb = manager.createQueryBuilder(Report, 'r').update(Report).set(patch);
  applyTargetGroupWhere(qb, '"Report"', report, 'g');
  const result = await qb.execute();
  return result.affected ?? 0;
}

/** Updates every distinct target group the given reports belong to, in one transaction. */
export async function updateReportGroups(reports: Report[], patch: Record<string, unknown>): Promise<number> {
  if (reports.length === 0) return 0;

  // Deduplicate groups by their target key to avoid updating the same group twice
  const seen = new Set<string>();
  const unique: Report[] = [];
  for (const report of reports) {
    const key = toTargetGroupKey(report);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(report);
  }

  // One statement per group, so a failure partway through would otherwise leave
  // some groups moved to the new status and others not. A transaction runs on a
  // single query runner, so these have to be issued sequentially.
  return Report.getRepository().manager.transaction(async (manager) => {
    let updated = 0;
    for (const report of unique) {
      updated += await updateReportGroup(report, patch, manager);
    }
    return updated;
  });
}

export async function deleteReportGroup(report: Report): Promise<number> {
  const qb = Report.createQueryBuilder('r').delete().from(Report);
  applyTargetGroupWhere(qb, '"Report"', report, 'g');
  const result = await qb.execute();
  return result.affected ?? 0;
}

/** The filter shape accepted by the bulk update/delete endpoints. */
type BulkReportFilterInput = {
  status?: string;
  source?: string;
  targetType?: string;
  targetMediaId?: number;
  targetEpisodeNumber?: number;
  targetSegmentId?: number;
  auditRunId?: number;
  orphaned?: boolean;
};

function parseBulkFilters(filters: BulkReportFilterInput): AdminReportFilters {
  return {
    statuses: parseStatusFilter(filters.status),
    source: filters.source as ReportSource | undefined,
    targetType: filters.targetType as ReportTargetType | undefined,
    targetMediaId: filters.targetMediaId,
    targetEpisodeNumber: filters.targetEpisodeNumber,
    targetSegmentId: filters.targetSegmentId,
    auditRunId: filters.auditRunId,
    orphaned: filters.orphaned,
  };
}

/**
 * Bulk update and delete refuse to run unfiltered -- an empty filter set would
 * otherwise match every report in the table.
 */
function hasAnyFilter(filters: AdminReportFilters): boolean {
  return !!(
    filters.statuses ||
    filters.source ||
    filters.targetType ||
    filters.targetMediaId !== undefined ||
    filters.targetEpisodeNumber !== undefined ||
    filters.targetSegmentId !== undefined ||
    filters.auditRunId !== undefined ||
    filters.orphaned
  );
}

/**
 * Parses bulk filters and refuses an empty set.
 *
 * Parsing and validating together rather than as two steps the caller must
 * remember to sequence: an unguarded bulk update matches the entire table.
 */
export function parseAndRequireBulkFilters(filters: BulkReportFilterInput | undefined): AdminReportFilters {
  const parsed = filters ? parseBulkFilters(filters) : {};
  if (!hasAnyFilter(parsed)) {
    throw new InvalidRequestError('At least one filter is required for bulk operations');
  }
  return parsed;
}
