import type { MediaAuditCheck, CheckRunContext, CheckResult } from './index';
import { runCategoryFilteredQuery } from './queryHelper';

export const dbEsSyncIssues: MediaAuditCheck = {
  name: 'dbEsSyncIssues',
  label: 'DB/ES Sync Issues',
  description: 'Media where database and Elasticsearch segment counts diverge',
  targetType: 'MEDIA',
  thresholdSchema: [
    { key: 'minDifference', label: 'Min segment count difference', type: 'number', default: 5, min: 1 },
  ],

  async run(ctx: CheckRunContext): Promise<CheckResult[]> {
    const minDifference = ctx.threshold.minDifference as number;

    if (!ctx.esClient) return [];

    const dbRows = await runCategoryFilteredQuery(ctx.dataSource, {
      sql: `
        SELECT m.id AS "mediaId", m.romaji_name AS "romajiName",
               COALESCE(m.num_segments, 0) AS "dbCount"
        FROM "Media" m
        WHERE 1=1
      `,
      category: ctx.category,
    });

    const esResponse = await ctx.esClient.search({
      index: '_all',
      size: 0,
      body: {
        aggs: {
          media: {
            terms: { field: 'mediaId', size: 10000 },
          },
        },
      },
    });

    const esCounts = new Map<number, number>();
    const buckets =
      (esResponse.aggregations?.media as { buckets: Array<{ key: number; doc_count: number }> })?.buckets ?? [];
    for (const bucket of buckets) {
      esCounts.set(bucket.key, bucket.doc_count);
    }

    const results: CheckResult[] = [];

    for (const row of dbRows as { mediaId: number; romajiName: string; dbCount: string }[]) {
      const dbCount = Number(row.dbCount);
      const esCount = esCounts.get(row.mediaId) ?? 0;
      const difference = dbCount - esCount;

      if (Math.abs(difference) >= minDifference) {
        results.push({
          targetType: 'MEDIA',
          mediaId: row.mediaId,
          data: { dbCount, esCount, difference },
          description: `${row.romajiName}: DB=${dbCount}, ES=${esCount} (diff: ${difference})`,
        });
      }
    }

    return results;
  },
};
