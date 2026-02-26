import type { t_Report, t_AdminReport } from 'generated/models';
import type {
  CreateReportRequestOutput,
  ListAdminReportsQueryOutput,
  UpdateReportRequestOutput,
} from 'generated/outputTypes';
import type { Report } from '@app/models';
import { ReportReason, ReportSource, ReportStatus, ReportTargetType } from '@app/models';

const requireReportField = <T>(report: Report, field: string, value: T | null | undefined): T => {
  if (value == null) {
    throw new Error(`Report ${report.id} has targetType=${report.targetType} but missing ${field}`);
  }
  return value;
};

const toReportTargetDTO = (report: Report): t_Report['target'] => {
  switch (report.targetType) {
    case 'SEGMENT':
      return {
        type: 'SEGMENT',
        mediaId: report.targetMediaId,
        segmentUuid: requireReportField(report, 'targetSegmentUuid', report.targetSegmentUuid),
        ...(report.targetEpisodeNumber != null ? { episodeNumber: report.targetEpisodeNumber } : {}),
      };
    case 'EPISODE':
      return {
        type: 'EPISODE',
        mediaId: report.targetMediaId,
        episodeNumber: requireReportField(report, 'targetEpisodeNumber', report.targetEpisodeNumber),
      };
    default:
      return {
        type: 'MEDIA',
        mediaId: report.targetMediaId,
      };
  }
};

export type AdminReportFilters = {
  status?: ReportStatus;
  source?: ReportSource;
  targetType?: ReportTargetType;
  targetMediaId?: number;
  targetEpisodeNumber?: number;
  targetSegmentUuid?: string;
  auditRunId?: number;
};

export const toReportDTO = (report: Report): t_Report => {
  return {
    id: report.id,
    source: report.source,
    target: toReportTargetDTO(report),
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

export const toAdminReportDTO = (report: Report, reportCount: number): t_AdminReport => {
  return {
    ...toReportDTO(report),
    reportCount,
    reporterName: report.user?.username ?? 'System',
  };
};

type ReportCreateAttributesInput = {
  body: CreateReportRequestOutput;
  userId: number;
};

export function toReportCreateAttributes({ body, userId }: ReportCreateAttributesInput): Partial<Report> {
  return {
    source: ReportSource.USER,
    targetType: body.target.type as ReportTargetType,
    targetMediaId: body.target.mediaId,
    targetEpisodeNumber: 'episodeNumber' in body.target ? (body.target.episodeNumber ?? null) : null,
    targetSegmentUuid: body.target.type === 'SEGMENT' ? body.target.segmentUuid : null,
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
    targetSegmentUuid: query['target.segmentUuid'],
    auditRunId: query.auditRunId,
  };
}

export function toReportTargetCountKey(report: Pick<Report, 'targetType' | 'targetMediaId'>): string {
  return `${report.targetType}:${report.targetMediaId}`;
}

export function toAdminReportListDTO(reports: Report[], countMap: ReadonlyMap<string, number>): t_AdminReport[] {
  return reports.map((report) => toAdminReportDTO(report, countMap.get(toReportTargetCountKey(report)) ?? 1));
}
