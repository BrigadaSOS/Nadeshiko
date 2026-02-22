import type { MediaAuditCheck, CheckRunContext, CheckResult } from './index';
import { runCategoryFilteredQuery } from './queryHelper';

export const missingTranslations: MediaAuditCheck = {
  name: 'missingTranslations',
  label: 'Missing Translations',
  description: 'Episodes with segments missing English translations',
  targetType: 'EPISODE',
  thresholdSchema: [
    { key: 'minMissingCount', label: 'Min missing translation count', type: 'number', default: 1, min: 1 },
  ],

  async run(ctx: CheckRunContext): Promise<CheckResult[]> {
    const minMissingCount = ctx.threshold.minMissingCount as number;

    const rows = await runCategoryFilteredQuery(ctx.dataSource, {
      sql: `
        SELECT s.media_id AS "mediaId", s.episode AS "episodeNumber",
               m.romaji_name AS "romajiName",
               COUNT(*) FILTER (WHERE s.content_english IS NULL OR s.content_english = '') AS "missingEnCount",
               COUNT(*) FILTER (WHERE s.content_spanish IS NULL OR s.content_spanish = '') AS "missingEsCount",
               COUNT(*) AS "totalCount"
        FROM "Segment" s
        JOIN "Media" m ON m.id = s.media_id AND m.deleted_at IS NULL
        WHERE s.status = 'ACTIVE'
      `,
      category: ctx.category,
      suffix: `GROUP BY s.media_id, s.episode, m.romaji_name`,
    });

    const results: CheckResult[] = [];

    for (const row of rows as { mediaId: number; episodeNumber: number; romajiName: string; missingEnCount: string; missingEsCount: string; totalCount: string }[]) {
      const missingEnCount = Number(row.missingEnCount);
      if (missingEnCount >= minMissingCount) {
        results.push({
          targetType: 'EPISODE',
          mediaId: row.mediaId,
          episodeNumber: row.episodeNumber,
          data: { missingEnCount, missingEsCount: Number(row.missingEsCount), totalCount: Number(row.totalCount) },
          description: `${row.romajiName} EP${row.episodeNumber}: ${missingEnCount} segments missing English translation`,
        });
      }
    }

    return results;
  },
};
