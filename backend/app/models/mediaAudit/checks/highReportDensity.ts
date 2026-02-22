import type { MediaAuditCheck, CheckRunContext, CheckResult } from './index';
import { runCategoryFilteredQuery } from './queryHelper';

export const highReportDensity: MediaAuditCheck = {
  name: 'highReportDensity',
  label: 'High Report Density',
  description: 'Media with many user-submitted reports',
  targetType: 'MEDIA',
  thresholdSchema: [{ key: 'minReportCount', label: 'Min report count', type: 'number', default: 3, min: 1 }],

  async run(ctx: CheckRunContext): Promise<CheckResult[]> {
    const minReportCount = ctx.threshold.minReportCount as number;

    const rows = await runCategoryFilteredQuery(ctx.dataSource, {
      sql: `
        SELECT r.target_media_id AS "mediaId",
               m.romaji_name AS "romajiName",
               COUNT(*) AS "reportCount",
               COUNT(*) FILTER (WHERE r.status = 'PENDING') AS "pendingCount"
        FROM "Report" r
        JOIN "Media" m ON m.id = r.target_media_id AND m.deleted_at IS NULL
        WHERE r.source = 'USER'
      `,
      category: ctx.category,
      suffix: `
        GROUP BY r.target_media_id, m.romaji_name
        HAVING COUNT(*) >= $NEXT
      `,
      suffixParams: [minReportCount],
    });

    return (rows as { mediaId: number; romajiName: string; reportCount: string; pendingCount: string }[]).map(
      (row) => ({
        targetType: 'MEDIA' as const,
        mediaId: row.mediaId,
        data: { reportCount: Number(row.reportCount), pendingCount: Number(row.pendingCount) },
        description: `${row.romajiName}: ${row.reportCount} user reports (${row.pendingCount} pending)`,
      }),
    );
  },
};
