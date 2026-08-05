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
import { In, IsNull, type FindOptionsWhere, type QueryDeepPartialEntity } from 'typeorm';
import { Report, ReportSource, Segment, Media } from '@app/models';
import { NotFoundError, InvalidRequestError } from '@app/errors';
import { assertUser } from '@app/middleware/authentication';
import {
  toAdminReportFilters,
  toAdminReportGroupsDTO,
  toReportCreateAttributes,
  toReportDTO,
  toReportUpdatePatch,
  resolveReportPublicIds,
  resolveReportPublicIdsForOne,
} from '@app/controllers/mappers/reportMapper';
import {
  applyReportFilters,
  buildGroupRepresentativesQuery,
  deleteReportGroup,
  fetchGroupMembers,
  parseAndRequireBulkFilters,
  updateReportGroup,
  updateReportGroups,
} from '@app/services/reports/reportQueries';

export const createUserReport: CreateUserReport = async ({ body }, respond, req) => {
  const user = assertUser(req);
  const resolved = await resolveReportTarget(body.target);

  const attributes = toReportCreateAttributes({
    body,
    userId: Number(user.id),
    resolvedSegmentId: resolved.segmentId,
    resolvedMediaId: resolved.mediaId,
  });

  // Mirrors the UQ_Report_user_target_reason index so the read-back finds exactly
  // the row the index would have rejected a second copy of. Derived from the
  // attributes actually being inserted rather than restated, so the two cannot
  // drift — note `IsNull()` and not `undefined`, which TypeORM drops from the
  // WHERE entirely and which used to make a media report match a segment report.
  const duplicateWhere: FindOptionsWhere<Report> = {
    userId: Number(user.id),
    source: ReportSource.USER,
    targetType: attributes.targetType,
    targetMediaId: attributes.targetMediaId,
    targetEpisodeNumber: attributes.targetEpisodeNumber ?? IsNull(),
    targetSegmentId: attributes.targetSegmentId ?? IsNull(),
    reason: attributes.reason,
  };

  // Insert-or-ignore rather than check-then-insert: a double-clicked report button
  // sends two requests that both pass a pre-check, and the index turns the loser
  // into a no-op instead of a 500. Not raising also keeps this safe to call inside
  // a surrounding transaction, where a failed statement poisons every query after
  // it. The cast is TypeORM's _QueryDeepPartialEntity recursion issue with JSONB
  // columns — same as the note in app/models/Segment.ts.
  await Report.createQueryBuilder()
    .insert()
    .into(Report)
    .values(attributes as QueryDeepPartialEntity<Report>)
    .orIgnore()
    .execute();

  // Reads back whichever row is there now — the one just inserted, or the one that
  // was already reported — so repeat submissions are idempotent.
  const report = await Report.findOneOrFail({ where: duplicateWhere });
  const ids = await resolveReportPublicIdsForOne(report);

  return respond.with201().body(toReportDTO(report, ids));
};

export const listAdminReports: ListAdminReports = async ({ query }, respond) => {
  const filters = toAdminReportFilters(query);

  // Step 1: Get one representative row per target group (paginated)
  const { items: groupReps, pagination } = await Report.paginateWithKeyset({
    take: query.take,
    cursor: query.cursor,
    query: () => buildGroupRepresentativesQuery(filters),
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
    await updateReportGroup(r, { status: body.status }, Report.getRepository().manager);
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

  const parsed = parseAndRequireBulkFilters(filters);

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

  const parsed = parseAndRequireBulkFilters(filters);

  const qb = Report.createQueryBuilder('report').delete().from(Report);
  applyReportFilters(qb, '"Report"', parsed, 'bulk');

  const result = await qb.execute();
  return respond.with200().body({ count: result.affected ?? 0 });
};

async function resolveReportTarget(
  target: CreateReportRequestOutput['target'],
): Promise<{ segmentId: number | null; mediaId: number }> {
  const media = await Media.findOne({ where: { publicId: target.mediaPublicId }, select: ['id', 'publicId'] });
  if (!media) {
    throw new NotFoundError(`Media with publicId ${target.mediaPublicId} not found`);
  }

  if (target.type === 'SEGMENT') {
    const segment = await Segment.findOne({
      where: [{ publicId: target.segmentPublicId }, { uuid: target.segmentPublicId }],
    });
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
