import type { MediaReviewCheck, CheckRunContext, CheckResult } from '../registry';

export const mediaWithNoEpisodes: MediaReviewCheck = {
  name: 'mediaWithNoEpisodes',
  label: 'Media With No Episodes',
  description: 'Media entries with zero episodes',
  targetType: 'MEDIA',
  thresholdSchema: [],

  async run(ctx: CheckRunContext): Promise<CheckResult[]> {
    let query = `
      SELECT m.id AS "mediaId", m.romaji_name AS "romajiName", m.created_at AS "createdAt"
      FROM "Media" m
      LEFT JOIN "Episode" e ON e.media_id = m.id AND e.deleted_at IS NULL
      WHERE m.deleted_at IS NULL
    `;
    const params: unknown[] = [];

    if (ctx.category) {
      query += ` AND m.category = $${params.length + 1}`;
      params.push(ctx.category);
    }

    query += ` GROUP BY m.id, m.romaji_name, m.created_at HAVING COUNT(e.episode_number) = 0`;

    const rows = await ctx.dataSource.query(query, params);

    return rows.map((row: { mediaId: number; romajiName: string }) => ({
      targetType: 'MEDIA' as const,
      mediaId: row.mediaId,
      data: {},
      description: `${row.romajiName}: no episodes found`,
    }));
  },
};
