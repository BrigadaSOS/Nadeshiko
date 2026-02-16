import type { t_Report, t_AdminReport } from 'generated/models';
import type { Report } from '@app/models';

export const toReportDTO = (report: Report): t_Report => {
  return {
    id: report.id,
    source: report.source,
    targetType: report.targetType,
    targetMediaId: report.targetMediaId,
    targetEpisodeNumber: report.targetEpisodeNumber ?? null,
    targetSegmentUuid: report.targetSegmentUuid ?? null,
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
