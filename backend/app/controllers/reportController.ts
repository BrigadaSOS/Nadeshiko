import type { CreateUserReport, ListUserReports } from 'generated/routes/user';
import type { ListAdminReports, UpdateAdminReport } from 'generated/routes/admin';
import { Report, ReportSource, ReportTargetType, ReportStatus, ReportReason, Segment, Media } from '@app/models';
import { NotFoundError, InvalidRequestError } from '@app/errors';
import { assertUser } from '@app/middleware/authentication';
import { toReportDTO, toAdminReportDTO } from '@app/controllers/mappers/report.mapper';

export const createUserReport: CreateUserReport = async ({ body }, respond, req) => {
  const user = assertUser(req);

  const { target, reason, description } = body;

  // Validate target exists
  if (target.type === 'SEGMENT') {
    const segment = await Segment.findOne({ where: { uuid: target.segmentUuid } });
    if (!segment) {
      throw new NotFoundError(`Segment with UUID ${target.segmentUuid} not found`);
    }
    if (segment.mediaId !== target.mediaId) {
      throw new InvalidRequestError('SEGMENT target mediaId does not match segment mediaId');
    }
  }

  const media = await Media.findOne({ where: { id: target.mediaId } });
  if (!media) {
    throw new NotFoundError(`Media with ID ${target.mediaId} not found`);
  }

  const report = new Report();
  report.source = ReportSource.USER;
  report.targetType = target.type as ReportTargetType;
  report.targetMediaId = target.mediaId;
  report.targetEpisodeNumber = 'episodeNumber' in target ? (target.episodeNumber ?? null) : null;
  report.targetSegmentUuid = target.type === 'SEGMENT' ? target.segmentUuid : null;
  report.reason = reason as ReportReason;
  report.description = description ?? null;
  report.userId = Number(user.id);
  report.status = ReportStatus.PENDING;

  await report.save();

  return respond.with201().body(toReportDTO(report));
};

export const listUserReports: ListUserReports = async ({ query }, respond, req) => {
  const user = assertUser(req);

  const { items: reports, pagination } = await Report.paginateWithKeyset({
    take: query.take,
    cursor: query.cursor,
    query: () => {
      const qb = Report.createQueryBuilder('report')
        .where('report.user_id = :userId', { userId: Number(user.id) })
        .andWhere('report.source = :source', { source: ReportSource.USER });

      if (query.status) {
        qb.andWhere('report.status = :status', { status: query.status });
      }

      return qb;
    },
  });

  return respond.with200().body({
    reports: reports.map(toReportDTO),
    pagination,
  });
};

export const listAdminReports: ListAdminReports = async ({ query }, respond) => {
  const { status, source, reviewCheckRunId } = query;
  const targetType = query['target.type'];
  const targetMediaId = query['target.mediaId'];
  const targetEpisodeNumber = query['target.episodeNumber'];
  const targetSegmentUuid = query['target.segmentUuid'];

  const { items: reports, pagination } = await Report.paginateWithKeyset({
    take: query.take,
    cursor: query.cursor,
    query: () => {
      const qb = Report.createQueryBuilder('report').leftJoinAndSelect('report.user', 'user');

      if (status) {
        qb.andWhere('report.status = :status', { status });
      }
      if (source) {
        qb.andWhere('report.source = :source', { source });
      }
      if (targetType) {
        qb.andWhere('report.target_type = :targetType', { targetType });
      }
      if (targetMediaId !== undefined) {
        qb.andWhere('report.target_media_id = :targetMediaId', { targetMediaId });
      }
      if (targetEpisodeNumber !== undefined) {
        qb.andWhere('report.target_episode_number = :targetEpisodeNumber', { targetEpisodeNumber });
      }
      if (targetSegmentUuid !== undefined) {
        qb.andWhere('report.target_segment_uuid = :targetSegmentUuid', { targetSegmentUuid });
      }
      if (reviewCheckRunId) {
        qb.andWhere('report.review_check_run_id = :reviewCheckRunId', { reviewCheckRunId });
      }

      return qb;
    },
  });

  // Compute report counts per (targetType, targetMediaId) for the returned reports
  const targets = [...new Set(reports.map((r) => `${r.targetType}:${r.targetMediaId}`))];
  const countMap = new Map<string, number>();

  if (targets.length > 0) {
    const countResults = await Report.createQueryBuilder('r')
      .select('r.target_type', 'targetType')
      .addSelect('r.target_media_id', 'targetMediaId')
      .addSelect('COUNT(*)', 'count')
      .where(
        targets.map((_, i) => `(r.target_type = :tt${i} AND r.target_media_id = :mid${i})`).join(' OR '),
        Object.fromEntries(
          targets.flatMap((t, i) => {
            const [tt, mid] = t.split(':');
            return [
              [`tt${i}`, tt],
              [`mid${i}`, Number(mid)],
            ];
          }),
        ),
      )
      .groupBy('r.target_type')
      .addGroupBy('r.target_media_id')
      .getRawMany();

    for (const row of countResults) {
      countMap.set(`${row.targetType}:${row.targetMediaId}`, Number(row.count));
    }
  }

  return respond.with200().body({
    reports: reports.map((report) =>
      toAdminReportDTO(report, countMap.get(`${report.targetType}:${report.targetMediaId}`) ?? 1),
    ),
    pagination,
  });
};

export const updateAdminReport: UpdateAdminReport = async ({ params, body }, respond) => {
  const { id } = params;

  const report = await Report.findOne({ where: { id } });
  if (!report) {
    throw new NotFoundError(`Report with ID ${id} not found`);
  }

  if (body.status) {
    report.status = body.status as ReportStatus;
  }

  if (body.adminNotes !== undefined) {
    report.adminNotes = body.adminNotes ?? null;
  }

  await report.save();

  return respond.with200().body(toReportDTO(report));
};
