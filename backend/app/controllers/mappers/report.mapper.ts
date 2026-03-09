import type { t_Report, t_AdminReport } from 'generated/models';
import type {
  CreateReportRequestOutput,
  ListAdminReportsQueryOutput,
  UpdateReportRequestOutput,
} from 'generated/outputTypes';
import type { Report } from '@app/models';
import { Media, Segment, ReportReason, ReportSource, ReportStatus, ReportTargetType } from '@app/models';

const requireReportField = <T>(report: Report, field: string, value: T | null | undefined): T => {
  if (value == null) {
    throw new Error(`Report ${report.id} has targetType=${report.targetType} but missing ${field}`);
  }
  return value;
};

type ReportPublicIds = {
  mediaPublicId: string;
  segmentPublicId?: string | null;
};

const toReportTargetDTO = (report: Report, ids: ReportPublicIds): t_Report['target'] => {
  switch (report.targetType) {
    case 'SEGMENT':
      return {
        type: 'SEGMENT',
        mediaId: ids.mediaPublicId,
        segmentId: ids.segmentPublicId ?? null,
        ...(report.targetEpisodeNumber != null ? { episodeNumber: report.targetEpisodeNumber } : {}),
      };
    case 'EPISODE':
      return {
        type: 'EPISODE',
        mediaId: ids.mediaPublicId,
        episodeNumber: requireReportField(report, 'targetEpisodeNumber', report.targetEpisodeNumber),
      };
    default:
      return {
        type: 'MEDIA',
        mediaId: ids.mediaPublicId,
      };
  }
};

export type AdminReportFilters = {
  status?: ReportStatus;
  source?: ReportSource;
  targetType?: ReportTargetType;
  targetMediaId?: number;
  targetEpisodeNumber?: number;
  targetSegmentId?: number;
  auditRunId?: number;
};

export const toReportDTO = (report: Report, ids: ReportPublicIds): t_Report => {
  return {
    id: report.id,
    source: report.source,
    target: toReportTargetDTO(report, ids),
    auditRunId: report.auditRunId ?? null,
    reason: report.reason,
    description: report.description ?? null,
    data: report.data ?? null,
    status: report.status,
    adminNotes: report.adminNotes ?? null,
    userId: report.userId ?? null,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt?.toISOString() ?? null,
  };
};

export const toAdminReportDTO = (report: Report, reportCount: number, ids: ReportPublicIds): t_AdminReport => {
  return {
    ...toReportDTO(report, ids),
    reportCount,
    reporterName: report.user?.username ?? 'System',
  };
};

type ReportCreateAttributesInput = {
  body: CreateReportRequestOutput;
  userId: number;
  resolvedSegmentId: number | null;
  resolvedMediaId: number;
};

export function toReportCreateAttributes({
  body,
  userId,
  resolvedSegmentId,
  resolvedMediaId,
}: ReportCreateAttributesInput): Partial<Report> {
  return {
    source: ReportSource.USER,
    targetType: body.target.type as ReportTargetType,
    targetMediaId: resolvedMediaId,
    targetEpisodeNumber: 'episodeNumber' in body.target ? (body.target.episodeNumber ?? null) : null,
    targetSegmentId: resolvedSegmentId,
    reason: body.reason as ReportReason,
    description: body.description ?? null,
    userId,
    status: ReportStatus.PENDING,
  };
}

export function toReportUpdatePatch(body: UpdateReportRequestOutput): Partial<Report> {
  const patch: Partial<Report> = {};
  if (body.status !== undefined) patch.status = body.status as ReportStatus;
  if (body.adminNotes !== undefined) patch.adminNotes = body.adminNotes ?? null;
  return patch;
}

export function toAdminReportFilters(query: ListAdminReportsQueryOutput): AdminReportFilters {
  return {
    status: query.status as ReportStatus | undefined,
    source: query.source as ReportSource | undefined,
    targetType: query['target.type'] as ReportTargetType | undefined,
    targetMediaId: query['target.mediaId'],
    targetEpisodeNumber: query['target.episodeNumber'],
    targetSegmentId: query['target.segmentId'],
    auditRunId: query.auditRunId,
  };
}

export function toReportTargetCountKey(report: Pick<Report, 'targetType' | 'targetMediaId'>): string {
  return `${report.targetType}:${report.targetMediaId}`;
}

export type ReportPublicIdMaps = { media: ReadonlyMap<number, string>; segments: ReadonlyMap<number, string> };

export function toAdminReportListDTO(
  reports: Report[],
  countMap: ReadonlyMap<string, number>,
  publicIdMaps: ReportPublicIdMaps,
): t_AdminReport[] {
  return reports.map((report) =>
    toAdminReportDTO(report, countMap.get(toReportTargetCountKey(report)) ?? 1, {
      mediaPublicId: publicIdMaps.media.get(report.targetMediaId) ?? '',
      segmentPublicId: report.targetSegmentId ? (publicIdMaps.segments.get(report.targetSegmentId) ?? null) : null,
    }),
  );
}

export async function resolveReportPublicIds(reports: Report[]): Promise<ReportPublicIdMaps> {
  const mediaIds = [...new Set(reports.map((r) => r.targetMediaId))];
  const segmentIds = [...new Set(reports.map((r) => r.targetSegmentId).filter((id): id is number => id != null))];

  const { In } = await import('typeorm');
  const [mediaEntries, segmentEntries] = await Promise.all([
    mediaIds.length > 0 ? Media.find({ where: { id: In(mediaIds) }, select: ['id', 'publicId'] }) : [],
    segmentIds.length > 0 ? Segment.find({ where: { id: In(segmentIds) }, select: ['id', 'publicId'] }) : [],
  ]);

  return {
    media: new Map(mediaEntries.map((m) => [m.id, m.publicId])),
    segments: new Map(segmentEntries.map((s) => [s.id, s.publicId])),
  };
}
