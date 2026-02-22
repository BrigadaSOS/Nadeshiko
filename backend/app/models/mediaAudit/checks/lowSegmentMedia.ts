import type { MediaAuditCheck, CheckRunContext, CheckResult } from './index';
import { runCategoryFilteredQuery } from './queryHelper';

export const lowSegmentMedia: MediaAuditCheck = {
  name: 'lowSegmentMedia',
  label: 'Low Segment Media',
  description: 'Media with average segments per episode below threshold',
  targetType: 'MEDIA',
  thresholdSchema: [
    { key: 'minAvgSegmentsPerEpisode', label: 'Min avg segments per episode', type: 'number', default: 100, min: 1 },
  ],

  async run(ctx: CheckRunContext): Promise<CheckResult[]> {
    const minAvg = ctx.threshold.minAvgSegmentsPerEpisode as number;

    const rows = await runCategoryFilteredQuery(ctx.dataSource, {
      sql: `
        SELECT m.id AS "mediaId", m.romaji_name AS "romajiName",
               COUNT(DISTINCT e.episode_number) AS "episodeCount",
               COALESCE(m.num_segments, 0) AS "segmentCount"
        FROM "Media" m
        LEFT JOIN "Episode" e ON e.media_id = m.id AND e.deleted_at IS NULL
        WHERE m.deleted_at IS NULL
      `,
      category: ctx.category,
      suffix: `
        GROUP BY m.id, m.romaji_name, m.num_segments
        HAVING COUNT(DISTINCT e.episode_number) > 0
      `,
    });

    const results: CheckResult[] = [];

    for (const row of rows as { mediaId: number; romajiName: string; episodeCount: string; segmentCount: string }[]) {
      const episodeCount = Number(row.episodeCount);
      const segmentCount = Number(row.segmentCount);
      const avgSegPerEp = episodeCount > 0 ? segmentCount / episodeCount : 0;

      if (avgSegPerEp < minAvg) {
        results.push({
          targetType: 'MEDIA',
          mediaId: row.mediaId,
          data: { avgSegPerEp: Math.round(avgSegPerEp * 10) / 10, episodeCount, segmentCount },
          description: `${row.romajiName}: avg ${Math.round(avgSegPerEp)} segments/episode (threshold: ${minAvg})`,
        });
      }
    }

    return results;
  },
};
