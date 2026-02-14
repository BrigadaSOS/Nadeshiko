import type { t_Report, t_AdminReport } from 'generated/models';
import type { Report } from '@app/models';

export const toReportDTO = (report: Report): t_Report => {
  return {
    id: report.id,
    reportType: report.reportType,
    targetId: report.targetId,
    reason: report.reason,
    description: report.description ?? null,
    status: report.status,
    adminNotes: report.adminNotes ?? null,
    resolvedAt: report.resolvedAt?.toISOString() ?? null,
    userId: report.userId,
    resolvedById: report.resolvedById ?? null,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt?.toISOString() ?? null,
  };
};

export const toAdminReportDTO = (report: Report, reportCount: number): t_AdminReport => {
  return {
    ...toReportDTO(report),
    reportCount,
    reporterName: report.user?.username ?? 'Unknown',
  };
};
