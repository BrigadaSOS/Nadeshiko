import { WordFrequency } from '@app/models';
import { AppDataSource } from '@config/database';
import { Cache, createCacheNamespace } from '@lib/cache';
import { updateWordCoverage } from '@app/services/wordCoverageService';
import type { GetStatsOverview, GetCoveredWords, TriggerCoveredWordsUpdate } from 'generated/routes/stats';

const CACHE = createCacheNamespace('stats');
const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

const TIERS = [1000, 2000, 5000, 10000, 20000, 50000, 100000];

export const getStatsOverview: GetStatsOverview = async (_params, respond) => {
  const cached = Cache.get(CACHE, 'overview');
  if (cached) return respond.with200().body(cached as any);

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

  const body = {
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

  Cache.set(CACHE, 'overview', body, ONE_WEEK);
  return respond.with200().body(body);
};

export const getCoveredWords: GetCoveredWords = async ({ query }, respond) => {
  const tier = Number(query.tier);
  const minRank = Number(query.minRank ?? 0);
  const { filter, cursor, take } = query;

  const startRank = cursor > minRank ? cursor : minRank;

  const conditions = ['rank <= $1', 'rank > $2'];
  if (filter === 'covered') conditions.push('match_count > 0');
  if (filter === 'uncovered') conditions.push('match_count = 0');

  const tierStatsKey = `tier-stats-${minRank}-${tier}`;
  let tierStats = Cache.get(CACHE, tierStatsKey) as { total: number; covered: number; uncovered: number } | null;

  if (!tierStats) {
    const [statsRow] = await WordFrequency.query(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE match_count > 0)::int AS covered,
        COUNT(*) FILTER (WHERE match_count = 0)::int AS uncovered
      FROM "WordFrequency"
      WHERE rank <= $1 AND rank > $2`,
      [tier, minRank],
    );
    tierStats = {
      total: statsRow.total as number,
      covered: statsRow.covered as number,
      uncovered: statsRow.uncovered as number,
    };
    Cache.set(CACHE, tierStatsKey, tierStats, ONE_WEEK);
  }

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

  const nextCursor = hasMore ? (words[words.length - 1]?.rank ?? null) : null;

  return respond.with200().body({ words, nextCursor, tierStats });
};

export const triggerCoveredWordsUpdate: TriggerCoveredWordsUpdate = async ({ body }, respond) => {
  const result = await updateWordCoverage({
    maxRank: body?.maxRank ?? 999999,
    onlyUncovered: body?.onlyUncovered ?? false,
  });

  Cache.invalidate(CACHE);

  return respond.with200().body(result);
};
