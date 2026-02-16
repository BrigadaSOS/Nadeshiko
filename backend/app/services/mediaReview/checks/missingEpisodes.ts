import type { MediaReviewCheck, CheckRunContext, CheckResult } from '../registry';

export const missingEpisodes: MediaReviewCheck = {
  name: 'missingEpisodes',
  label: 'Missing Episodes',
  description: 'Media with gaps in episode numbering sequence',
  targetType: 'MEDIA',
  thresholdSchema: [],

  async run(ctx: CheckRunContext): Promise<CheckResult[]> {
    let query = `
      SELECT m.id AS "mediaId", m.romaji_name AS "romajiName",
             array_agg(e.episode_number ORDER BY e.episode_number) AS "episodes"
      FROM "Media" m
      JOIN "Episode" e ON e.media_id = m.id AND e.deleted_at IS NULL
      WHERE m.deleted_at IS NULL
    `;
    const params: unknown[] = [];

    if (ctx.category) {
      query += ` AND m.category = $${params.length + 1}`;
      params.push(ctx.category);
    }

    query += ` GROUP BY m.id, m.romaji_name HAVING COUNT(*) > 1`;

    const rows = await ctx.dataSource.query(query, params);
    const results: CheckResult[] = [];

    for (const row of rows) {
      const episodes: number[] = row.episodes;
      if (episodes.length < 2) continue;

      const min = episodes[0]!;
      const max = episodes[episodes.length - 1]!;
      const expected = new Set(Array.from({ length: max - min + 1 }, (_, i) => min + i));
      const actual = new Set(episodes);
      const missing = [...expected].filter((e) => !actual.has(e));

      if (missing.length > 0) {
        results.push({
          targetType: 'MEDIA',
          mediaId: row.mediaId,
          data: { missingCount: missing.length, missingEpisodes: missing.slice(0, 20), totalEpisodes: episodes.length },
          description: `${row.romajiName}: ${missing.length} missing episodes (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''})`,
        });
      }
    }

    return results;
  },
};
