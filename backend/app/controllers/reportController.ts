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

  const { targetType, targetMediaId, targetSegmentUuid, reason, description } = body;

  // Validate target exists
  if (targetType === 'SEGMENT') {
    if (!targetSegmentUuid) {
      throw new InvalidRequestError('targetSegmentUuid is required for SEGMENT reports');
    }
    const segment = await Segment.findOne({ where: { uuid: targetSegmentUuid } });
    if (!segment) {
      throw new NotFoundError(`Segment with UUID ${targetSegmentUuid} not found`);
    }
  }

  const media = await Media.findOne({ where: { id: targetMediaId } });
  if (!media) {
    throw new NotFoundError(`Media with ID ${targetMediaId} not found`);
  }

  const report = new Report();
  report.source = ReportSource.USER;
  report.targetType = targetType as ReportTargetType;
  report.targetMediaId = targetMediaId;
  report.targetSegmentUuid = targetSegmentUuid ?? null;
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

  const { cursor, size, status } = query;

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
    take: size + 1,
  });

  const hasMore = reports.length > size;
  const data = hasMore ? reports.slice(0, size) : reports;
  const nextCursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;

  return respond.with200().body({
    data: data.map(toReportDTO),
    hasMore,
    cursor: nextCursor,
  });
};

export const adminReportIndex: AdminReportIndex = async ({ query }, respond) => {
  const { cursor, size = 20, status, source, targetType, targetMediaId, reviewCheckRunId } = query;

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
  if (targetMediaId) {
    where.targetMediaId = targetMediaId;
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
    take: size + 1,
  });

  const hasMore = reports.length > size;
  const data = hasMore ? reports.slice(0, size) : reports;
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
    data: data.map((report) =>
      toAdminReportDTO(report, countMap.get(`${report.targetType}:${report.targetMediaId}`) ?? 1),
    ),
    hasMore,
    cursor: nextCursor,
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
