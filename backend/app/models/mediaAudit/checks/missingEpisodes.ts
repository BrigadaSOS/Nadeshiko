import type { MediaAuditCheck, CheckRunContext, CheckResult } from './index';
import { runCategoryFilteredQuery } from './queryHelper';

export const missingEpisodes: MediaAuditCheck = {
  name: 'missingEpisodes',
  label: 'Missing Episodes',
  description: 'Media with zero episodes or gaps in episode numbering',
  targetType: 'MEDIA',
  thresholdSchema: [],

  async run(ctx: CheckRunContext): Promise<CheckResult[]> {
    const results: CheckResult[] = [];

    const noEpisodeRows = await runCategoryFilteredQuery(ctx.dataSource, {
      sql: `
        SELECT m.id AS "mediaId", m.romaji_name AS "romajiName"
        FROM "Media" m
        LEFT JOIN "Episode" e ON e.media_id = m.id AND e.deleted_at IS NULL
        WHERE m.deleted_at IS NULL
      `,
      category: ctx.category,
      suffix: `GROUP BY m.id, m.romaji_name HAVING COUNT(e.episode_number) = 0`,
    });

    for (const row of noEpisodeRows as { mediaId: number; romajiName: string }[]) {
      results.push({
        targetType: 'MEDIA',
        mediaId: row.mediaId,
        data: { missingCount: 0, totalEpisodes: 0, noEpisodes: true },
        description: `${row.romajiName}: no episodes found`,
      });
    }

    const gapRows = await runCategoryFilteredQuery(ctx.dataSource, {
      sql: `
        SELECT m.id AS "mediaId", m.romaji_name AS "romajiName",
               array_agg(e.episode_number ORDER BY e.episode_number) AS "episodes"
        FROM "Media" m
        JOIN "Episode" e ON e.media_id = m.id AND e.deleted_at IS NULL
        WHERE m.deleted_at IS NULL
      `,
      category: ctx.category,
      suffix: `GROUP BY m.id, m.romaji_name HAVING COUNT(*) > 1`,
    });

    for (const row of gapRows as { mediaId: number; romajiName: string; episodes: number[] }[]) {
      const episodes = row.episodes;
      if (episodes.length < 2) continue;

      const min = episodes[0];
      const max = episodes[episodes.length - 1];
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
