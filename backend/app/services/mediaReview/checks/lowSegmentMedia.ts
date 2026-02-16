import type { MediaReviewCheck, CheckRunContext, CheckResult } from '../registry';

export const lowSegmentMedia: MediaReviewCheck = {
  name: 'lowSegmentMedia',
  label: 'Low Segment Media',
  description: 'Media with average segments per episode below threshold',
  targetType: 'MEDIA',
  thresholdSchema: [
    { key: 'minAvgSegmentsPerEpisode', label: 'Min avg segments per episode', type: 'number', default: 100, min: 1 },
  ],

  async run(ctx: CheckRunContext): Promise<CheckResult[]> {
    const minAvg = ctx.threshold.minAvgSegmentsPerEpisode as number;

    let query = `
      SELECT m.id AS "mediaId", m.romaji_name AS "romajiName",
             COUNT(DISTINCT e.episode_number) AS "episodeCount",
             COALESCE(m.num_segments, 0) AS "segmentCount"
      FROM "Media" m
      LEFT JOIN "Episode" e ON e.media_id = m.id AND e.deleted_at IS NULL
      WHERE m.deleted_at IS NULL
    `;
    const params: unknown[] = [];

    if (ctx.category) {
      query += ` AND m.category = $${params.length + 1}`;
      params.push(ctx.category);
    }

    query += `
      GROUP BY m.id, m.romaji_name, m.num_segments
      HAVING COUNT(DISTINCT e.episode_number) > 0
    `;

    const rows = await ctx.dataSource.query(query, params);
    const results: CheckResult[] = [];

    for (const row of rows) {
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
