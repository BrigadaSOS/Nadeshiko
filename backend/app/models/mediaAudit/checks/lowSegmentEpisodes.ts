import type { MediaAuditCheck, CheckRunContext, CheckResult } from './index';
import { runCategoryFilteredQuery } from './queryHelper';

export const lowSegmentEpisodes: MediaAuditCheck = {
  name: 'lowSegmentEpisodes',
  label: 'Low Segment Episodes',
  description: 'Episodes with segment count below threshold',
  targetType: 'EPISODE',
  thresholdSchema: [
    { key: 'minSegments', label: 'Min segments per episode', type: 'number', default: 200, min: 0 },
  ],

  async run(ctx: CheckRunContext): Promise<CheckResult[]> {
    const minSegments = ctx.threshold.minSegments as number;

    const rows = await runCategoryFilteredQuery(ctx.dataSource, {
      sql: `
        SELECT e.media_id AS "mediaId", e.episode_number AS "episodeNumber",
               COALESCE(e.num_segments, 0) AS "segmentCount",
               m.romaji_name AS "romajiName"
        FROM "Episode" e
        JOIN "Media" m ON m.id = e.media_id AND m.deleted_at IS NULL
        WHERE e.deleted_at IS NULL
          AND COALESCE(e.num_segments, 0) < $1
      `,
      params: [minSegments],
      category: ctx.category,
    });

    return (rows as { mediaId: number; episodeNumber: number; segmentCount: number; romajiName: string }[]).map(
      (row) => ({
        targetType: 'EPISODE' as const,
        mediaId: row.mediaId,
        episodeNumber: row.episodeNumber,
        data: { segmentCount: Number(row.segmentCount) },
        description: `${row.romajiName} EP${row.episodeNumber}: ${row.segmentCount} segments`,
      }),
    );
  },
};
