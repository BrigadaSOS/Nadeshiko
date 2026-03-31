import { WordFrequency } from '@app/models';
import { SegmentDocument } from '@app/models/SegmentDocument';
import { Cache, createCacheNamespace } from '@lib/cache';
import { logger } from '@config/log';

const STATS_CACHE = createCacheNamespace('stats');
const BATCH_SIZE = 200;

export interface CoverageUpdateResult {
  wordsChecked: number;
  newlyCovered: number;
  totalCovered: number;
  percentage: number;
}

async function processBatch(batch: { rank: number; word: string; matchCount: number }[]): Promise<number> {
  const words = batch.map((r) => r.word);
  const matchMap = await SegmentDocument.wordsCoverageCount(words, {
    category: ['ANIME', 'JDRAMA'],
    status: ['ACTIVE'],
  });

  let newlyCovered = 0;
  const updates: { rank: number; matchCount: number }[] = [];

  for (const row of batch) {
    const matchCount = matchMap.get(row.word) ?? 0;
    if (matchCount > 0 && row.matchCount === 0) newlyCovered++;
    updates.push({ rank: row.rank, matchCount });
  }

  const values = updates.map((_u, idx) => `($${idx * 2 + 1}::int, $${idx * 2 + 2}::int)`).join(', ');
  const params = updates.flatMap((u) => [u.rank, u.matchCount]);
  await WordFrequency.query(
    `UPDATE "WordFrequency" AS wf SET match_count = v.match_count, updated_at = NOW()
     FROM (VALUES ${values}) AS v(rank, match_count)
     WHERE wf.rank = v.rank`,
    params,
  );

  return newlyCovered;
}

/**
 * Updates match_count for words in the WordFrequency table by querying ES directly.
 * Can run for a specific rank range or only for uncovered words.
 */
export async function updateWordCoverage(options?: {
  maxRank?: number;
  onlyUncovered?: boolean;
}): Promise<CoverageUpdateResult> {
  const maxRank = options?.maxRank ?? 100000;
  const onlyUncovered = options?.onlyUncovered ?? false;

  const condition = onlyUncovered ? 'rank <= $1 AND match_count = 0' : 'rank <= $1';
  const rows: { rank: number; word: string; matchCount: number }[] = await WordFrequency.query(
    `SELECT rank, word, match_count AS "matchCount" FROM "WordFrequency" WHERE ${condition} ORDER BY rank`,
    [maxRank],
  );

  if (rows.length === 0) {
    return { wordsChecked: 0, newlyCovered: 0, totalCovered: 0, percentage: 0 };
  }

  logger.info({ count: rows.length, maxRank, onlyUncovered }, 'Starting word coverage update');

  let newlyCovered = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      newlyCovered += await processBatch(batch);
    } catch (err) {
      logger.error({ err }, 'Word coverage batch failed');
    }
  }

  const [countRow] = await WordFrequency.query(
    `SELECT COUNT(*) FILTER (WHERE match_count > 0)::int AS covered, COUNT(*)::int AS total
     FROM "WordFrequency" WHERE rank <= $1`,
    [maxRank],
  );

  const totalCovered = countRow.covered as number;
  const total = countRow.total as number;

  Cache.invalidate(STATS_CACHE);

  const result: CoverageUpdateResult = {
    wordsChecked: rows.length,
    newlyCovered,
    totalCovered,
    percentage: total > 0 ? Math.round((totalCovered / total) * 1000) / 10 : 0,
  };

  logger.info(result, 'Word coverage update complete');
  return result;
}
