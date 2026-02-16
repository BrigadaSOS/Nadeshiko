import type { MediaReviewCheck, CheckRunContext, CheckResult } from '../registry';

export const missingTranslations: MediaReviewCheck = {
  name: 'missingTranslations',
  label: 'Missing Translations',
  description: 'Episodes with segments missing English translations',
  targetType: 'EPISODE',
  thresholdSchema: [
    { key: 'minMissingCount', label: 'Min missing translation count', type: 'number', default: 1, min: 1 },
  ],

  async run(ctx: CheckRunContext): Promise<CheckResult[]> {
    const minMissingCount = ctx.threshold.minMissingCount as number;

    let query = `
      SELECT s.media_id AS "mediaId", s.episode AS "episodeNumber",
             m.romaji_name AS "romajiName",
             COUNT(*) FILTER (WHERE s.content_english IS NULL OR s.content_english = '') AS "missingEnCount",
             COUNT(*) FILTER (WHERE s.content_spanish IS NULL OR s.content_spanish = '') AS "missingEsCount",
             COUNT(*) AS "totalCount"
      FROM "Segment" s
      JOIN "Media" m ON m.id = s.media_id AND m.deleted_at IS NULL
      WHERE s.status = 'ACTIVE'
    `;
    const params: unknown[] = [];

    if (ctx.category) {
      query += ` AND m.category = $${params.length + 1}`;
      params.push(ctx.category);
    }

    query += ` GROUP BY s.media_id, s.episode, m.romaji_name`;

    const rows = await ctx.dataSource.query(query, params);
    const results: CheckResult[] = [];

    for (const row of rows) {
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
