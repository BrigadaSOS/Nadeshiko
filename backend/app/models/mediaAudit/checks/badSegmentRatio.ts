import type { MediaAuditCheck, CheckRunContext, CheckResult } from './index';
import { runCategoryFilteredQuery } from './queryHelper';

export const badSegmentRatio: MediaAuditCheck = {
  name: 'badSegmentRatio',
  label: 'Bad Segment Ratio',
  description: 'Episodes where ratio of non-ACTIVE segments exceeds threshold',
  targetType: 'EPISODE',
  thresholdSchema: [
    { key: 'maxBadRatio', label: 'Max bad segment ratio', type: 'number', default: 0.2, min: 0, max: 1 },
  ],

  async run(ctx: CheckRunContext): Promise<CheckResult[]> {
    const maxBadRatio = ctx.threshold.maxBadRatio as number;

    const rows = await runCategoryFilteredQuery(ctx.dataSource, {
      sql: `
        SELECT s.media_id AS "mediaId", s.episode AS "episodeNumber",
               m.romaji_name AS "romajiName",
               COUNT(*) AS "totalCount",
               COUNT(*) FILTER (WHERE s.status != 'ACTIVE' AND s.status != 'VERIFIED') AS "badCount"
        FROM "Segment" s
        JOIN "Media" m ON m.id = s.media_id AND m.deleted_at IS NULL
        WHERE s.status != 'DELETED'
      `,
      category: ctx.category,
      suffix: `
        GROUP BY s.media_id, s.episode, m.romaji_name
        HAVING COUNT(*) > 0
      `,
    });

    const results: CheckResult[] = [];

    for (const row of rows as {
      mediaId: number;
      episodeNumber: number;
      romajiName: string;
      totalCount: string;
      badCount: string;
    }[]) {
      const total = Number(row.totalCount);
      const bad = Number(row.badCount);
      const badRatio = total > 0 ? bad / total : 0;

      if (badRatio > maxBadRatio) {
        results.push({
          targetType: 'EPISODE',
          mediaId: row.mediaId,
          episodeNumber: row.episodeNumber,
          data: { badRatio: Math.round(badRatio * 1000) / 1000, badCount: bad, totalCount: total },
          description: `${row.romajiName} EP${row.episodeNumber}: ${Math.round(badRatio * 100)}% bad segments (${bad}/${total})`,
        });
      }
    }

    return results;
  },
};
