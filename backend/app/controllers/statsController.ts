import { WordFrequency } from '@app/models';
import { AppDataSource } from '@config/database';
import { Cache, createCacheNamespace } from '@lib/cache';
import { decodeKeysetCursor, encodeKeysetCursor } from '@lib/cursor';
import type { GetStatsOverview, GetCoveredWords, TriggerCoveredWordsUpdate } from 'generated/routes/stats';

const CACHE = createCacheNamespace('stats');
const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

const TIERS = [1000, 2000, 5000, 10000, 20000, 50000, 100000];

export const getStatsOverview: GetStatsOverview = async (_params, respond) => {
  const body = await Cache.getOrCompute(CACHE, 'overview', ONE_WEEK, async () => {
    const tierColumns = [...TIERS, 999999999]
      .map(
        (t, i) =>
          `COUNT(*) FILTER (WHERE rank <= ${t})::int AS t${i}_total,
         COUNT(*) FILTER (WHERE rank <= ${t} AND match_count > 0)::int AS t${i}_covered`,
      )
      .join(',\n       ');

    const [wordStats, mediaAggregates] = await Promise.all([
      WordFrequency.query(
        `SELECT
          COUNT(*)::int AS total_words,
          MAX(updated_at) FILTER (WHERE match_count > 0) AS last_updated,
          ${tierColumns}
        FROM "WordFrequency"`,
      ),
      AppDataSource.query(
        `SELECT
          COUNT(*)::int AS media,
          SUM(episode_count)::int AS episodes,
          SUM(num_segments)::int AS segments,
          SUM(dialogue_duration_ms)::bigint AS dialogue_ms,
          SUM(en_human_count)::int AS en_human,
          SUM(en_machine_count)::int AS en_machine,
          SUM(es_human_count)::int AS es_human,
          SUM(es_machine_count)::int AS es_machine
        FROM "Media"`,
      ),
    ]);

    const ws = wordStats[0];
    const totalFrequencyWords = ws.total_words as number;
    const allTiers = [...TIERS, totalFrequencyWords];

    const tiers = allTiers.map((tier, i) => {
      const total = Number(ws[`t${i}_total`] || 0);
      const covered = Number(ws[`t${i}_covered`] || 0);
      return {
        tier,
        covered,
        total,
        percentage: total > 0 ? Math.round((covered / total) * 1000) / 10 : 0,
      };
    });

    const lastUpdated = ws.last_updated ? new Date(ws.last_updated).toISOString() : null;
    const agg = mediaAggregates[0];
    const totalSegments = Number(agg.segments || 0);
    const dialogueHours = Math.round((Number(agg.dialogue_ms || 0) / 3_600_000) * 10) / 10;

    return {
      totalSegments,
      totalEpisodes: Number(agg.episodes || 0),
      totalMedia: Number(agg.media || 0),
      totalFrequencyWords,
      dialogueHours,
      tiers,
      lastUpdated,
      translations: {
        total: totalSegments,
        enHuman: Number(agg.en_human || 0),
        enMachine: Number(agg.en_machine || 0),
        esHuman: Number(agg.es_human || 0),
        esMachine: Number(agg.es_machine || 0),
      },
    };
  });

  return respond.with200().body(body);
};


export const getCoveredWords: GetCoveredWords = async ({ query }, respond) => {
  const tier = Number(query.tier);
  const minRank = Number(query.minRank ?? 0);
  const { filter, cursor, take } = query;

  const decodedRank = decodeKeysetCursor<number>(cursor) ?? 0;
  const startRank = decodedRank > minRank ? decodedRank : minRank;

  const conditions = ['rank <= $1', 'rank > $2'];
  if (filter === 'COVERED') conditions.push('match_count > 0');
  if (filter === 'UNCOVERED') conditions.push('match_count = 0');

  const tierStats = await Cache.getOrCompute(CACHE, `tier-stats-${minRank}-${tier}`, ONE_WEEK, async () => {
    const [statsRow] = await WordFrequency.query(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE match_count > 0)::int AS covered,
        COUNT(*) FILTER (WHERE match_count = 0)::int AS uncovered
      FROM "WordFrequency"
      WHERE rank <= $1 AND rank > $2`,
      [tier, minRank],
    );
    return {
      total: statsRow.total as number,
      covered: statsRow.covered as number,
      uncovered: statsRow.uncovered as number,
    };
  });

  const rows = (await WordFrequency.query(
    `SELECT rank, word, match_count
     FROM "WordFrequency"
     WHERE ${conditions.join(' AND ')}
     ORDER BY rank
     LIMIT $3`,
    [tier, startRank, take + 1],
  )) as { rank: number; word: string; match_count: number }[];

  const hasMore = rows.length > take;
  const words = (hasMore ? rows.slice(0, take) : rows).map((r) => ({
    rank: r.rank,
    word: r.word,
    matchCount: r.match_count,
  }));

  const lastRank = words[words.length - 1]?.rank;
  const nextCursor = hasMore && lastRank !== undefined ? encodeKeysetCursor(lastRank) : null;

  return respond.with200().body({
    words,
    pagination: { hasMore, cursor: nextCursor },
    tierStats,
  });
};


export const triggerCoveredWordsUpdate: TriggerCoveredWordsUpdate = async ({ body }, respond) => {
  const result = await WordFrequency.updateCoverage({
    maxRank: body?.maxRank ?? 999999,
    onlyUncovered: body?.onlyUncovered ?? false,
  });

  Cache.invalidate(CACHE);

  return respond.with200().body(result);
};
