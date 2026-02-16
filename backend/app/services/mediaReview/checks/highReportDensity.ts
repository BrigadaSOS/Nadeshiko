import type { MediaReviewCheck, CheckRunContext, CheckResult } from '../registry';

export const highReportDensity: MediaReviewCheck = {
  name: 'highReportDensity',
  label: 'High Report Density',
  description: 'Media with many user-submitted reports',
  targetType: 'MEDIA',
  thresholdSchema: [
    { key: 'minReportCount', label: 'Min report count', type: 'number', default: 3, min: 1 },
  ],

  async run(ctx: CheckRunContext): Promise<CheckResult[]> {
    const minReportCount = ctx.threshold.minReportCount as number;

    let query = `
      SELECT r.target_media_id AS "mediaId",
             m.romaji_name AS "romajiName",
             COUNT(*) AS "reportCount",
             COUNT(*) FILTER (WHERE r.status = 'PENDING') AS "pendingCount"
      FROM "Report" r
      JOIN "Media" m ON m.id = r.target_media_id AND m.deleted_at IS NULL
      WHERE r.source = 'USER'
    `;
    const params: unknown[] = [];

    if (ctx.category) {
      query += ` AND m.category = $${params.length + 1}`;
      params.push(ctx.category);
    }

    query += `
      GROUP BY r.target_media_id, m.romaji_name
      HAVING COUNT(*) >= $${params.length + 1}
    `;
    params.push(minReportCount);

    const rows = await ctx.dataSource.query(query, params);

    return rows.map((row: { mediaId: number; romajiName: string; reportCount: string; pendingCount: string }) => ({
      targetType: 'MEDIA' as const,
      mediaId: row.mediaId,
      data: { reportCount: Number(row.reportCount), pendingCount: Number(row.pendingCount) },
      description: `${row.romajiName}: ${row.reportCount} user reports (${row.pendingCount} pending)`,
    }));
  },
};
