import type { MediaReviewCheck, CheckRunContext, CheckResult } from '../registry';

export const emptyEpisodes: MediaReviewCheck = {
  name: 'emptyEpisodes',
  label: 'Empty Episodes',
  description: 'Episodes with segment count below threshold',
  targetType: 'EPISODE',
  thresholdSchema: [
    { key: 'minSegments', label: 'Min segments per episode', type: 'number', default: 10, min: 0 },
  ],

  async run(ctx: CheckRunContext): Promise<CheckResult[]> {
    const minSegments = ctx.threshold.minSegments as number;

    let query = `
      SELECT e.media_id AS "mediaId", e.episode_number AS "episodeNumber",
             COALESCE(e.num_segments, 0) AS "segmentCount",
             m.romaji_name AS "romajiName"
      FROM "Episode" e
      JOIN "Media" m ON m.id = e.media_id AND m.deleted_at IS NULL
      WHERE e.deleted_at IS NULL
        AND COALESCE(e.num_segments, 0) < $1
    `;
    const params: unknown[] = [minSegments];

    if (ctx.category) {
      query += ` AND m.category = $${params.length + 1}`;
      params.push(ctx.category);
    }

    const rows = await ctx.dataSource.query(query, params);

    return rows.map((row: { mediaId: number; episodeNumber: number; segmentCount: number; romajiName: string }) => ({
      targetType: 'EPISODE' as const,
      mediaId: row.mediaId,
      episodeNumber: row.episodeNumber,
      data: { segmentCount: Number(row.segmentCount) },
      description: `${row.romajiName} EP${row.episodeNumber}: ${row.segmentCount} segments (threshold: ${minSegments})`,
    }));
  },
};
