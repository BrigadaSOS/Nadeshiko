import type { CreateReport, GetUserReports } from 'generated/routes/user';
import type { GetAdminReports, UpdateReport } from 'generated/routes/admin';
import { Report, ReportStatus, Segment, Media } from '@app/models';
import { AuthCredentialsInvalidError, NotFoundError, InvalidRequestError } from '@app/errors';
import { toReportDTO, toAdminReportDTO } from '@app/controllers/mappers/report.mapper';
import { type FindOptionsWhere, LessThan } from 'typeorm';

export const createReport: CreateReport = async ({ body }, respond, req) => {
  const user = req.user;
  if (!user) {
    throw new AuthCredentialsInvalidError('Invalid session user.');
  }

  const { reportType, targetId, reason, description } = body;

  // Validate target exists
  if (reportType === 'SEGMENT') {
    const segment = await Segment.findOne({ where: { uuid: targetId } });
    if (!segment) {
      throw new NotFoundError(`Segment with UUID ${targetId} not found`);
    }
  } else if (reportType === 'MEDIA') {
    const mediaId = Number(targetId);
    if (Number.isNaN(mediaId)) {
      throw new InvalidRequestError('Invalid media ID');
    }
    const media = await Media.findOne({ where: { id: mediaId } });
    if (!media) {
      throw new NotFoundError(`Media with ID ${targetId} not found`);
    }
  }

  const report = Report.create({
    reportType,
    targetId,
    reason,
    description: description ?? null,
    userId: Number(user.id),
    status: ReportStatus.PENDING,
  });

  await report.save();

  return respond.with201().body(toReportDTO(report));
};

export const getUserReports: GetUserReports = async ({ query }, respond, req) => {
  const user = req.user;
  if (!user) {
    throw new AuthCredentialsInvalidError('Invalid session user.');
  }

  const { cursor, size, status } = query;

  const where: FindOptionsWhere<Report> = { userId: Number(user.id) };
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
  const nextCursor = hasMore ? data[data.length - 1].id : null;

  return respond.with200().body({
    data: data.map(toReportDTO),
    hasMore,
    cursor: nextCursor,
  });
};

export const getAdminReports: GetAdminReports = async ({ query }, respond) => {
  const { cursor, size = 20, status, reportType, targetId } = query;

  const where: FindOptionsWhere<Report> = {};
  if (status) {
    where.status = status as ReportStatus;
  }
  if (reportType) {
    where.reportType = reportType;
  }
  if (targetId) {
    where.targetId = targetId;
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
  const nextCursor = hasMore ? data[data.length - 1].id : null;

  // Compute report counts per (reportType, targetId) for the returned reports
  const targets = [...new Set(data.map((r) => `${r.reportType}:${r.targetId}`))];
  const countMap = new Map<string, number>();

  if (targets.length > 0) {
    const countResults = await Report.createQueryBuilder('r')
      .select('r.report_type', 'reportType')
      .addSelect('r.target_id', 'targetId')
      .addSelect('COUNT(*)', 'count')
      .where(
        targets
          .map((_, i) => `(r.report_type = :rt${i} AND r.target_id = :tid${i})`)
          .join(' OR '),
        Object.fromEntries(
          targets.flatMap((t, i) => {
            const [rt, ...rest] = t.split(':');
            return [
              [`rt${i}`, rt],
              [`tid${i}`, rest.join(':')],
            ];
          }),
        ),
      )
      .groupBy('r.report_type')
      .addGroupBy('r.target_id')
      .getRawMany();

    for (const row of countResults) {
      countMap.set(`${row.reportType}:${row.targetId}`, Number(row.count));
    }
  }

  return respond.with200().body({
    data: data.map((report) => toAdminReportDTO(report, countMap.get(`${report.reportType}:${report.targetId}`) ?? 1)),
    hasMore,
    cursor: nextCursor,
  });
};

export const updateReport: UpdateReport = async ({ params, body }, respond, req) => {
  const { id } = params;

  const report = await Report.findOne({ where: { id } });
  if (!report) {
    throw new NotFoundError(`Report with ID ${id} not found`);
  }

  if (body.status) {
    report.status = body.status as ReportStatus;

    if (['ACCEPTED', 'REJECTED', 'RESOLVED'].includes(body.status)) {
      report.resolvedAt = new Date();
      report.resolvedById = req.user ? Number(req.user.id) : null;
    } else {
      report.resolvedAt = null;
      report.resolvedById = null;
    }
  }

  if (body.adminNotes !== undefined) {
    report.adminNotes = body.adminNotes ?? null;
  }

  await report.save();

  return respond.with200().body(toReportDTO(report));
};
