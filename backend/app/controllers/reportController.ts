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
} from '@app/controllers/mappers/report.mapper';

export const createUserReport: CreateUserReport = async ({ body }, respond, req) => {
  const user = assertUser(req);
  await assertUserReportTargetExists(body.target);

  const report = Report.create(
    toReportCreateAttributes({
      body,
      userId: Number(user.id),
    }),
  );
  await report.save();

  return respond.with201().body(toReportDTO(report));
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
      if (filters.targetSegmentUuid !== undefined) {
        qb.andWhere('report.target_segment_uuid = :targetSegmentUuid', { targetSegmentUuid: filters.targetSegmentUuid });
      }
      if (filters.auditRunId !== undefined) {
        qb.andWhere('report.audit_run_id = :auditRunId', { auditRunId: filters.auditRunId });
      }

      return qb;
    },
  });

  const countMap = await countReportsByTarget(reports);

  return respond.with200().body({
    reports: toAdminReportListDTO(reports, countMap),
    pagination,
  });
};

export const updateAdminReport: UpdateAdminReport = async ({ params, body }, respond) => {
  const report = await Report.findAndUpdateOrFail({
    where: { id: params.id },
    patch: toReportUpdatePatch(body),
    detail: `Report with ID ${params.id} not found`,
  });

  return respond.with200().body(toReportDTO(report as Report));
};

async function assertUserReportTargetExists(target: CreateReportRequestOutput['target']): Promise<void> {
  if (target.type === 'SEGMENT') {
    const segment = await Segment.findOne({ where: { uuid: target.segmentUuid } });
    if (!segment) {
      throw new NotFoundError(`Segment with UUID ${target.segmentUuid} not found`);
    }
    if (segment.mediaId !== target.mediaId) {
      throw new InvalidRequestError('SEGMENT target mediaId does not match segment mediaId');
    }
    return;
  }

  const mediaExists = await Media.existsBy({ id: target.mediaId });
  if (!mediaExists) {
    throw new NotFoundError(`Media with ID ${target.mediaId} not found`);
  }
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

  const where = targets.map((_, index) => `(r.target_type = :tt${index} AND r.target_media_id = :mid${index})`).join(' OR ');

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
