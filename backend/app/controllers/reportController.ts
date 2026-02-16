import type { UserReportCreate, UserReportIndex } from 'generated/routes/user';
import type { AdminReportIndex, AdminReportUpdate } from 'generated/routes/admin';
import { Report, ReportSource, ReportTargetType, ReportStatus, ReportReason, Segment, Media } from '@app/models';
import { AuthCredentialsInvalidError, NotFoundError, InvalidRequestError } from '@app/errors';
import { toReportDTO, toAdminReportDTO } from '@app/controllers/mappers/report.mapper';
import { type FindOptionsWhere, LessThan } from 'typeorm';

export const userReportCreate: UserReportCreate = async ({ body }, respond, req) => {
  const user = req.user;
  if (!user) {
    throw new AuthCredentialsInvalidError('Invalid session user.');
  }

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

export const userReportIndex: UserReportIndex = async ({ query }, respond, req) => {
  const user = req.user;
  if (!user) {
    throw new AuthCredentialsInvalidError('Invalid session user.');
  }

  const { cursor, limit, status } = query;

  const where: FindOptionsWhere<Report> = { userId: Number(user.id), source: ReportSource.USER };
  if (status) {
    where.status = status as ReportStatus;
  }
  if (cursor) {
    where.id = LessThan(cursor);
  }

  const reports = await Report.find({
    where,
    order: { id: 'DESC' },
    take: limit + 1,
  });

  const hasMore = reports.length > limit;
  const data = hasMore ? reports.slice(0, limit) : reports;
  const nextCursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;

  return respond.with200().body({
    reports: data.map(toReportDTO),
    pagination: {
      hasMore,
      cursor: nextCursor,
    },
  });
};

export const adminReportIndex: AdminReportIndex = async ({ query }, respond) => {
  const { cursor, limit = 20, status, source, reviewCheckRunId } = query;
  const targetType = (query as Record<string, unknown>)['target.type'] as ReportTargetType | undefined;
  const targetMediaId = (query as Record<string, unknown>)['target.mediaId'] as number | undefined;
  const targetEpisodeNumber = (query as Record<string, unknown>)['target.episodeNumber'] as number | undefined;
  const targetSegmentUuid = (query as Record<string, unknown>)['target.segmentUuid'] as string | undefined;

  const where: FindOptionsWhere<Report> = {};
  if (status) {
    where.status = status as ReportStatus;
  }
  if (source) {
    where.source = source as ReportSource;
  }
  if (targetType) {
    where.targetType = targetType as ReportTargetType;
  }
  if (targetMediaId !== undefined) {
    where.targetMediaId = targetMediaId;
  }
  if (targetEpisodeNumber !== undefined) {
    where.targetEpisodeNumber = targetEpisodeNumber;
  }
  if (targetSegmentUuid !== undefined) {
    where.targetSegmentUuid = targetSegmentUuid;
  }
  if (reviewCheckRunId) {
    where.reviewCheckRunId = reviewCheckRunId;
  }
  if (cursor) {
    where.id = LessThan(cursor);
  }

  const reports = await Report.find({
    where,
    relations: ['user'],
    order: { id: 'DESC' },
    take: limit + 1,
  });

  const hasMore = reports.length > limit;
  const data = hasMore ? reports.slice(0, limit) : reports;
  const nextCursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;

  // Compute report counts per (targetType, targetMediaId) for the returned reports
  const targets = [...new Set(data.map((r) => `${r.targetType}:${r.targetMediaId}`))];
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
    reports: data.map((report) =>
      toAdminReportDTO(report, countMap.get(`${report.targetType}:${report.targetMediaId}`) ?? 1),
    ),
    pagination: {
      hasMore,
      cursor: nextCursor,
    },
  });
};

export const adminReportUpdate: AdminReportUpdate = async ({ params, body }, respond) => {
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
