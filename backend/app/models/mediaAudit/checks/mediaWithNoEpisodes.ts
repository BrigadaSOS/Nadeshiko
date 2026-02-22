import type { MediaAuditCheck, CheckRunContext, CheckResult } from './index';
import { runCategoryFilteredQuery } from './queryHelper';

export const mediaWithNoEpisodes: MediaAuditCheck = {
  name: 'mediaWithNoEpisodes',
  label: 'Media With No Episodes',
  description: 'Media entries with zero episodes',
  targetType: 'MEDIA',
  thresholdSchema: [],

  async run(ctx: CheckRunContext): Promise<CheckResult[]> {
    const rows = await runCategoryFilteredQuery(ctx.dataSource, {
      sql: `
        SELECT m.id AS "mediaId", m.romaji_name AS "romajiName", m.created_at AS "createdAt"
        FROM "Media" m
        LEFT JOIN "Episode" e ON e.media_id = m.id AND e.deleted_at IS NULL
        WHERE m.deleted_at IS NULL
      `,
      category: ctx.category,
      suffix: `GROUP BY m.id, m.romaji_name, m.created_at HAVING COUNT(e.episode_number) = 0`,
    });

    return (rows as { mediaId: number; romajiName: string }[]).map((row) => ({
      targetType: 'MEDIA' as const,
      mediaId: row.mediaId,
      data: {},
      description: `${row.romajiName}: no episodes found`,
    }));
  },
};
