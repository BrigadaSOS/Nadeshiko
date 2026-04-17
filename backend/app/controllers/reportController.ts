import type { CreateReportRequestOutput } from 'generated/outputTypes';
import type { CreateUserReport } from 'generated/routes/user';
import type {
  ListAdminReports,
  UpdateAdminReport,
  DeleteAdminReport,
  BatchUpdateAdminReports,
  BulkUpdateAdminReports,
  BulkDeleteAdminReports,
} from 'generated/routes/admin';
import { In } from 'typeorm';
import { Report, ReportReason, ReportSource, ReportTargetType, Segment, Media } from '@app/models';
import { NotFoundError, InvalidRequestError } from '@app/errors';
import { assertUser } from '@app/middleware/authentication';
import {
  type AdminReportFilters,
  parseStatusFilter,
  toAdminReportFilters,
  toAdminReportGroupsDTO,
  toReportCreateAttributes,
  toReportDTO,
  toTargetGroupKey,
  toReportUpdatePatch,
  resolveReportPublicIds,
  resolveReportPublicIdsForOne,
} from '@app/controllers/mappers/reportMapper';

export const createUserReport: CreateUserReport = async ({ body }, respond, req) => {
  const user = assertUser(req);
  const resolved = await resolveReportTarget(body.target);

  // Check if this user already reported the same target+reason
  const existing = await Report.findOne({
    where: {
      userId: Number(user.id),
      targetType: body.target.type as ReportTargetType,
      targetMediaId: resolved.mediaId,
      targetSegmentId: resolved.segmentId ?? undefined,
      reason: body.reason as ReportReason,
    },
  });

  if (existing) {
    // Return the existing report instead of creating a duplicate
    const ids = await resolveReportPublicIdsForOne(existing);
    return respond.with201().body(toReportDTO(existing, ids));
  }

  const report = Report.create(
    toReportCreateAttributes({
      body,
      userId: Number(user.id),
      resolvedSegmentId: resolved.segmentId,
      resolvedMediaId: resolved.mediaId,
    }),
  ) as Report;
  await report.save();

  return respond.with201().body(
    toReportDTO(report, {
      mediaPublicId: body.target.mediaPublicId,
      segmentPublicId: 'segmentPublicId' in body.target ? body.target.segmentPublicId : null,
    }),
  );
};


export const listAdminReports: ListAdminReports = async ({ query }, respond) => {
  const filters = toAdminReportFilters(query);

  // Step 1: Get one representative row per target group (paginated)
  const { items: groupReps, pagination } = await Report.paginateWithKeyset({
    take: query.take,
    cursor: query.cursor,
    query: () => {
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
    },
  });

  if (groupReps.length === 0) {
    return respond.with200().body({ groups: [], pagination });
  }

  // Step 2: For those target groups, fetch all member reports
  const allReports = await fetchGroupMembers(groupReps, filters);
  const publicIdMaps = await resolveReportPublicIds(groupReps);

  return respond.with200().body({
    groups: toAdminReportGroupsDTO(groupReps, allReports, publicIdMaps),
    pagination,
  });
};


export const updateAdminReport: UpdateAdminReport = async ({ params, body }, respond) => {
  const report = await Report.findAndUpdateOrFail({
    where: { id: params.reportId },
    patch: toReportUpdatePatch(body),
    detail: `Report with ID ${params.reportId} not found`,
  });

  const r = report as Report;

  // Propagate only status to siblings (admin notes are per-report, not per-group)
  if (body.status !== undefined) {
    await updateReportGroup(r, { status: body.status });
  }

  const ids = await resolveReportPublicIdsForOne(r);
  return respond.with200().body(toReportDTO(r, ids));
};


export const batchUpdateAdminReports: BatchUpdateAdminReports = async ({ body }, respond) => {
  const { ids, status, adminNotes } = body;

  const patch: Record<string, unknown> = { status };
  if (adminNotes !== undefined) patch.adminNotes = adminNotes;

  // Look up the selected reports to find their group keys, then update all siblings
  const reports = await Report.findBy({ id: In(ids) });
  const updated = await updateReportGroups(reports, patch);

  return respond.with200().body({ count: updated });
};


export const bulkUpdateAdminReports: BulkUpdateAdminReports = async ({ body }, respond) => {
  const { status, adminNotes, filters } = body;

  const parsed = filters ? parseBulkFilters(filters) : {};
  if (!hasAnyFilter(parsed)) {
    throw new InvalidRequestError('At least one filter is required for bulk operations');
  }

  const patch: Record<string, unknown> = { status };
  if (adminNotes !== undefined) patch.adminNotes = adminNotes;

  const qb = Report.createQueryBuilder('report').update(Report).set(patch);
  applyReportFilters(qb, '"Report"', parsed, 'bulk');

  const result = await qb.execute();

  return respond.with200().body({ count: result.affected ?? 0 });
};


export const deleteAdminReport: DeleteAdminReport = async ({ params }, respond) => {
  const report = await Report.findOne({ where: { id: params.reportId } });
  if (!report) {
    throw new NotFoundError(`Report with ID ${params.reportId} not found`);
  }

  const deleted = await deleteReportGroup(report);
  return respond.with200().body({ count: deleted });
};


export const bulkDeleteAdminReports: BulkDeleteAdminReports = async ({ body }, respond) => {
  const { filters } = body;

  const parsed = filters ? parseBulkFilters(filters) : {};
  if (!hasAnyFilter(parsed)) {
    throw new InvalidRequestError('At least one filter is required for bulk operations');
  }

  const qb = Report.createQueryBuilder('report').delete().from(Report);
  applyReportFilters(qb, '"Report"', parsed, 'bulk');

  const result = await qb.execute();
  return respond.with200().body({ count: result.affected ?? 0 });
};


function parseBulkFilters(filters: {
  status?: string;
  source?: string;
  targetType?: string;
  targetMediaId?: number;
  targetEpisodeNumber?: number;
  targetSegmentId?: number;
  auditRunId?: number;
  orphaned?: boolean;
}): AdminReportFilters {
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


function applyTargetGroupWhere(
  qb: { andWhere(where: string, params?: Record<string, unknown>): unknown },
  alias: string,
  report: Report,
  prefix: string,
): void {
  qb.andWhere(`${alias}.target_type = :${prefix}_tt`, { [`${prefix}_tt`]: report.targetType });
  qb.andWhere(`${alias}.target_media_id = :${prefix}_mid`, { [`${prefix}_mid`]: report.targetMediaId });

  if (report.targetEpisodeNumber != null) {
    qb.andWhere(`${alias}.target_episode_number = :${prefix}_ep`, { [`${prefix}_ep`]: report.targetEpisodeNumber });
  } else {
    qb.andWhere(`${alias}.target_episode_number IS NULL`);
  }

  if (report.targetSegmentId != null) {
    qb.andWhere(`${alias}.target_segment_id = :${prefix}_sid`, { [`${prefix}_sid`]: report.targetSegmentId });
  } else {
    qb.andWhere(`${alias}.target_segment_id IS NULL`);
  }
}


async function updateReportGroup(report: Report, patch: Record<string, unknown>): Promise<number> {
  const qb = Report.createQueryBuilder('r').update(Report).set(patch);
  applyTargetGroupWhere(qb, '"Report"', report, 'g');
  const result = await qb.execute();
  return result.affected ?? 0;
}


async function updateReportGroups(reports: Report[], patch: Record<string, unknown>): Promise<number> {
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

  const results = await Promise.all(unique.map((r) => updateReportGroup(r, patch)));
  return results.reduce((sum, n) => sum + n, 0);
}


async function deleteReportGroup(report: Report): Promise<number> {
  const qb = Report.createQueryBuilder('r').delete().from(Report);
  applyTargetGroupWhere(qb, '"Report"', report, 'g');
  const result = await qb.execute();
  return result.affected ?? 0;
}


function applyReportFilters(
  qb: { andWhere(where: string, params?: Record<string, unknown>): unknown },
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


async function resolveReportTarget(
  target: CreateReportRequestOutput['target'],
): Promise<{ segmentId: number | null; mediaId: number }> {
  const media = await Media.findOne({ where: { publicId: target.mediaPublicId }, select: ['id', 'publicId'] });
  if (!media) {
    throw new NotFoundError(`Media with publicId ${target.mediaPublicId} not found`);
  }

  if (target.type === 'SEGMENT') {
    const segment = await Segment.findOne({ where: [{ publicId: target.segmentPublicId }, { uuid: target.segmentPublicId }] });
    if (!segment) {
      throw new NotFoundError(`Segment with ID ${target.segmentPublicId} not found`);
    }
    if (segment.mediaId !== media.id) {
      throw new InvalidRequestError('SEGMENT target mediaId does not match segment mediaId');
    }
    if (target.episodeNumber !== undefined && segment.episode !== target.episodeNumber) {
      throw new InvalidRequestError('SEGMENT target episodeNumber does not match segment episode');
    }
    return { segmentId: segment.id, mediaId: media.id };
  }

  return { segmentId: null, mediaId: media.id };
}


async function fetchGroupMembers(groupReps: Report[], filters: AdminReportFilters): Promise<Report[]> {
  // Build OR conditions for each target group's composite key
  const qb = Report.createQueryBuilder('r').leftJoinAndSelect('r.user', 'u').orderBy('r.created_at', 'DESC');

  applyReportFilters(qb, 'r', filters);

  const conditions: string[] = [];
  const params: Record<string, unknown> = {};
  for (let i = 0; i < groupReps.length; i++) {
    const rep = groupReps[i];
    let cond = `(r.target_type = :g${i}_tt AND r.target_media_id = :g${i}_mid`;
    params[`g${i}_tt`] = rep.targetType;
    params[`g${i}_mid`] = rep.targetMediaId;

    if (rep.targetEpisodeNumber != null) {
      cond += ` AND r.target_episode_number = :g${i}_ep`;
      params[`g${i}_ep`] = rep.targetEpisodeNumber;
    } else {
      cond += ' AND r.target_episode_number IS NULL';
    }

    if (rep.targetSegmentId != null) {
      cond += ` AND r.target_segment_id = :g${i}_sid`;
      params[`g${i}_sid`] = rep.targetSegmentId;
    } else {
      cond += ' AND r.target_segment_id IS NULL';
    }

    conditions.push(`${cond})`);
  }

  qb.andWhere(`(${conditions.join(' OR ')})`, params);
  return qb.getMany();
}
