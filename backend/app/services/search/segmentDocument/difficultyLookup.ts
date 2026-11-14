import { WordFrequency } from '@app/models';
import { logger } from '@config/log';
import { buildRankLookup, type RankLookup } from './difficulty';

/** The frequency list changes only on a reseed, which needs a full reindex anyway (a new process), so one load serves a
 * whole reindex. The hour bounds how long a long-lived server keeps a stale list for incremental indexing. */
const TTL_MS = 60 * 60 * 1000;

const EMPTY: RankLookup = { word: new Map(), form: new Map() };

let cached: { lookup: RankLookup; loadedAt: number } | null = null;
let pending: Promise<RankLookup> | null = null;

async function load(): Promise<RankLookup> {
  try {
    const rows: { rank: number; word: string; form: string | null; isName: boolean }[] = await WordFrequency.query(
      'SELECT rank, word, form, is_name AS "isName" FROM "WordFrequency"',
    );
    const lookup = buildRankLookup(rows);
    cached = { lookup, loadedAt: Date.now() };
    if (rows.length === 0) logger.warn('WordFrequency is empty; segments are indexed without a difficulty');
    return lookup;
  } catch (error) {
    // Indexing must not fail over the sort key. A reload that fails keeps the list already loaded; with none,
    // documents simply lack `difficulty` and sort last until a reindex.
    if (cached) {
      logger.warn({ err: error }, 'Could not reload WordFrequency; keeping the list loaded before');
      return cached.lookup;
    }
    logger.warn({ err: error }, 'Could not load WordFrequency; indexing without difficulty');
    return EMPTY;
  } finally {
    pending = null;
  }
}

/** The rank lookup for `computeDifficulty`, loaded once and shared by concurrent callers. */
export function loadDifficultyLookup(): Promise<RankLookup> {
  if (cached && Date.now() - cached.loadedAt < TTL_MS) return Promise.resolve(cached.lookup);
  pending ??= load();
  return pending;
}

/** Drops the cached list, for tests that seed WordFrequency. */
export function resetDifficultyLookup(): void {
  cached = null;
  pending = null;
}
