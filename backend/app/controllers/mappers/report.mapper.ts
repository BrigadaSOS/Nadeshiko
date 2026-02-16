import type { t_Report, t_AdminReport } from 'generated/models';
import type { Report } from '@app/models';

const toReportTargetDTO = (report: Report): t_Report['target'] => {
  switch (report.targetType) {
    case 'SEGMENT':
      return {
        type: 'SEGMENT',
        mediaId: report.targetMediaId,
        segmentUuid: report.targetSegmentUuid ?? '',
        ...(report.targetEpisodeNumber != null ? { episodeNumber: report.targetEpisodeNumber } : {}),
      };
    case 'EPISODE':
      return {
        type: 'EPISODE',
        mediaId: report.targetMediaId,
        episodeNumber: report.targetEpisodeNumber ?? 0,
      };
    default:
      return {
        type: 'MEDIA',
        mediaId: report.targetMediaId,
      };
  }
};

export const toReportDTO = (report: Report): t_Report => {
  return {
    id: report.id,
    source: report.source,
    target: toReportTargetDTO(report),
    reviewCheckRunId: report.reviewCheckRunId ?? null,
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
