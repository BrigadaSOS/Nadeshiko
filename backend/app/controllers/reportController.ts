import type { CreateReportRequestOutput } from 'generated/outputTypes';
import type { CreateUserReport } from 'generated/routes/user';
import type { ListAdminReports, UpdateAdminReport } from 'generated/routes/admin';
import { Report, ReportTargetType, Segment, Media } from '@app/models';
import { NotFoundError, InvalidRequestError } from '@app/errors';
import { assertUser } from '@app/middleware/authentication';
import {
  toAdminReportFilters,
  toAdminReportListDTO,
  toReportCreateAttributes,
  toReportDTO,
  toReportTargetCountKey,
  toReportUpdatePatch,
  resolveReportPublicIds,
} from '@app/controllers/mappers/report.mapper';

export const createUserReport: CreateUserReport = async ({ body }, respond, req) => {
  const user = assertUser(req);
  const resolved = await resolveReportTarget(body.target);

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
      mediaPublicId: body.target.mediaId,
      segmentPublicId: 'segmentId' in body.target ? body.target.segmentId : null,
    }),
  );
};

export const listAdminReports: ListAdminReports = async ({ query }, respond) => {
  const filters = toAdminReportFilters(query);

  const { items: reports, pagination } = await Report.paginateWithKeyset({
    take: query.take,
    cursor: query.cursor,
    query: () => {
      const qb = Report.createQueryBuilder('report').leftJoinAndSelect('report.user', 'user');

      if (filters.status) {
        qb.andWhere('report.status = :status', { status: filters.status });
      }
      if (filters.source) {
        qb.andWhere('report.source = :source', { source: filters.source });
      }
      if (filters.targetType) {
        qb.andWhere('report.target_type = :targetType', { targetType: filters.targetType });
      }
      if (filters.targetMediaId !== undefined) {
        qb.andWhere('report.target_media_id = :targetMediaId', { targetMediaId: filters.targetMediaId });
      }
      if (filters.targetEpisodeNumber !== undefined) {
        qb.andWhere('report.target_episode_number = :targetEpisodeNumber', {
          targetEpisodeNumber: filters.targetEpisodeNumber,
        });
      }
      if (filters.targetSegmentId !== undefined) {
        qb.andWhere('report.target_segment_id = :targetSegmentId', {
          targetSegmentId: filters.targetSegmentId,
        });
      }
      if (filters.auditRunId !== undefined) {
        qb.andWhere('report.audit_run_id = :auditRunId', { auditRunId: filters.auditRunId });
      }

      return qb;
    },
  });

  const [countMap, reportPublicIds] = await Promise.all([
    countReportsByTarget(reports),
    resolveReportPublicIds(reports),
  ]);

  return respond.with200().body({
    reports: toAdminReportListDTO(reports, countMap, reportPublicIds),
    pagination,
  });
};

export const updateAdminReport: UpdateAdminReport = async ({ params, body }, respond) => {
  const report = await Report.findAndUpdateOrFail({
    where: { id: params.id },
    patch: toReportUpdatePatch(body),
    detail: `Report with ID ${params.id} not found`,
  });

  const r = report as Report;
  const media = await Media.findOneOrFail({ where: { id: r.targetMediaId }, select: ['publicId'] });
  let segmentPublicId: string | null = null;
  if (r.targetSegmentId) {
    const segment = await Segment.findOne({ where: { id: r.targetSegmentId }, select: ['publicId'] });
    segmentPublicId = segment?.publicId ?? null;
  }
  return respond.with200().body(toReportDTO(r, { mediaPublicId: media.publicId, segmentPublicId }));
};

async function resolveReportTarget(
  target: CreateReportRequestOutput['target'],
): Promise<{ segmentId: number | null; mediaId: number }> {
  const media = await Media.findOne({ where: { publicId: target.mediaId }, select: ['id', 'publicId'] });
  if (!media) {
    throw new NotFoundError(`Media with publicId ${target.mediaId} not found`);
  }

  if (target.type === 'SEGMENT') {
    const segment = await Segment.findOne({ where: [{ publicId: target.segmentId }, { uuid: target.segmentId }] });
    if (!segment) {
      throw new NotFoundError(`Segment with ID ${target.segmentId} not found`);
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

type ReportCountRow = {
  targetType: ReportTargetType;
  targetMediaId: number;
  count: string;
};

async function countReportsByTarget(reports: Report[]): Promise<Map<string, number>> {
  const targets = [...new Set(reports.map(toReportTargetCountKey))];
  const countMap = new Map<string, number>();

  if (targets.length === 0) {
    return countMap;
  }

  const params = Object.fromEntries(
    targets.flatMap((target, index) => {
      const [targetType, targetMediaId] = target.split(':');
      return [
        [`tt${index}`, targetType],
        [`mid${index}`, Number(targetMediaId)],
      ];
    }),
  );

  const where = targets
    .map((_, index) => `(r.target_type = :tt${index} AND r.target_media_id = :mid${index})`)
    .join(' OR ');

  const rows = await Report.createQueryBuilder('r')
    .select('r.target_type', 'targetType')
    .addSelect('r.target_media_id', 'targetMediaId')
    .addSelect('COUNT(*)', 'count')
    .where(where, params)
    .groupBy('r.target_type')
    .addGroupBy('r.target_media_id')
    .getRawMany<ReportCountRow>();

  for (const row of rows) {
    countMap.set(`${row.targetType}:${row.targetMediaId}`, Number(row.count));
  }

  return countMap;
}
