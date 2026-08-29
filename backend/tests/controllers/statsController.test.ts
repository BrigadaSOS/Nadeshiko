import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { Application } from 'express';
import { buildApplication } from '@config/application';
import { StatsRoutes } from '@config/routes';
import { setupTestSuite } from '../helpers/setup';
import { useRawQueriesAgainstTestDb } from '../helpers/rawQuery';
import { WordFrequency } from '@app/models';
import { Cache } from '@lib/cache';
import { STATS_CACHE } from '@app/controllers/statsController';

/**
 * The corpus statistics endpoints, which are read by the site's stats page and
 * by the Discord bot's `/stats`.
 *
 * Two things here are worth an integration test rather than a unit one. The
 * word-coverage numbers come out of raw SQL with `FILTER (WHERE ...)` clauses
 * built by string interpolation over the tier list, so the only way to know
 * they count what they claim is to put rows in and read the answer back. And
 * `/covered-words` paginates by keyset over `rank`, which is the kind of thing
 * that looks right and silently repeats or skips a row at the page boundary.
 *
 * The overview is cached for a week, so every case clears the namespace first
 * -- otherwise the second test in the file asserts against the first one's rows.
 */
setupTestSuite();
// The media aggregate goes through `AppDataSource` rather than an entity.
useRawQueriesAgainstTestDb();

let app: Application;

/**
 * Coverage counting reaches Elasticsearch; the update endpoint's own SQL is
 * what is under test here, not the index. Typed with its real parameters so the
 * assertions on WHICH words and WHICH filters were asked for typecheck.
 */
const wordsCoverageCount = vi.fn(
  async (_words: string[], _filters: { category: string[]; status: string[] }) => new Map<string, number>(),
);
type CoverageArgs = Parameters<typeof wordsCoverageCount>;
vi.mock('@app/services/search/SegmentDocument', () => ({
  SegmentDocument: { wordsCoverageCount: (...args: CoverageArgs) => wordsCoverageCount(...args) },
}));

/** Replaces the frequency list with exactly these words. */
async function seedWords(words: { rank: number; word: string; matchCount?: number }[]) {
  await WordFrequency.query('DELETE FROM "WordFrequency"');
  if (words.length === 0) return;
  const values = words.map((_w, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(', ');
  const params = words.flatMap((w) => [w.rank, w.word, w.matchCount ?? 0]);
  await WordFrequency.query(`INSERT INTO "WordFrequency" (rank, word, match_count) VALUES ${values}`, params);
}

beforeAll(() => {
  app = buildApplication({
    rateLimit: false,
    mountRoutes: (instance) => {
      instance.use('/', StatsRoutes);
    },
  });
});

beforeEach(() => {
  Cache.invalidate(STATS_CACHE);
  wordsCoverageCount.mockReset().mockResolvedValue(new Map());
});

describe('GET /v1/stats/overview', () => {
  it('answers with the corpus totals', async () => {
    await seedWords([{ rank: 1, word: 'する', matchCount: 5 }]);

    const res = await request(app).get('/v1/stats/overview');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      totalSegments: expect.any(Number),
      totalEpisodes: expect.any(Number),
      totalMedia: expect.any(Number),
      totalFrequencyWords: expect.any(Number),
      dialogueHours: expect.any(Number),
    });
  });

  it('counts a word as covered only once it has a match', async () => {
    await seedWords([
      { rank: 1, word: 'する', matchCount: 5 },
      { rank: 2, word: 'いる', matchCount: 0 },
    ]);

    const res = await request(app).get('/v1/stats/overview');

    const fullCorpusTier = res.body.tiers[0];
    expect(fullCorpusTier).toMatchObject({
      tier: 2,
      total: 2,
      covered: 1,
      percentage: 50,
    });
  });

  it('reports each tier as a cumulative slice, not a disjoint band', async () => {
    // "Top 2000" means ranks 1..2000, which includes everything in "Top 1000".
    // Reading them as bands would make the coverage line go down as the tier
    // widens, which is not what the page claims to show.
    await seedWords(
      Array.from({ length: 2001 }, (_, i) => ({
        rank: i + 1,
        word: `w${i + 1}`,
        matchCount: i === 499 || i === 1499 ? 1 : 0,
      })),
    );

    const res = await request(app).get('/v1/stats/overview');

    const byTier = Object.fromEntries(res.body.tiers.map((t: { tier: number; total: number }) => [t.tier, t.total]));
    expect(byTier[1000]).toBe(1000);
    expect(byTier[2000]).toBe(2000);
  });

  it('ends with a tier covering the whole list, whatever size it is', async () => {
    // The last entry is the frequency list's own length rather than a fixed
    // number, which is what lets the client label it "full corpus".
    await seedWords([
      { rank: 1, word: 'a', matchCount: 1 },
      { rank: 200_000, word: 'b', matchCount: 0 },
    ]);

    const res = await request(app).get('/v1/stats/overview');

    expect(res.body.tiers.at(-1)).toMatchObject({ tier: 2, total: 2, covered: 1 });
    expect(res.body.totalFrequencyWords).toBe(2);
  });

  it('does not label a full-corpus aggregate as a larger fixed tier', async () => {
    await seedWords([
      { rank: 1, word: 'a', matchCount: 1 },
      { rank: 2, word: 'b', matchCount: 0 },
    ]);

    const res = await request(app).get('/v1/stats/overview');

    expect(res.body.tiers).toEqual([{ tier: 2, total: 2, covered: 1, percentage: 50 }]);
  });

  it('reports zero rather than dividing by zero on an empty tier', async () => {
    // Every tier above the largest seeded rank has no words in it at all.
    await seedWords([{ rank: 1, word: 'a', matchCount: 0 }]);

    const res = await request(app).get('/v1/stats/overview');

    for (const tier of res.body.tiers) {
      expect(Number.isFinite(tier.percentage)).toBe(true);
    }
  });

  it('survives an entirely empty frequency list', async () => {
    // The state a fresh database is in, and the one where every aggregate is
    // null rather than zero.
    await seedWords([]);

    const res = await request(app).get('/v1/stats/overview');

    expect(res.status).toBe(200);
    expect(res.body.totalFrequencyWords).toBe(0);
    expect(res.body.lastUpdated).toBeNull();
  });

  it('rounds coverage to one decimal, which is what the progress bar renders', async () => {
    await seedWords([
      { rank: 1, word: 'a', matchCount: 1 },
      { rank: 2, word: 'b', matchCount: 0 },
      { rank: 3, word: 'c', matchCount: 0 },
    ]);

    const res = await request(app).get('/v1/stats/overview');

    expect(res.body.tiers[0].percentage).toBe(33.3);
  });

  it('serves the second request from cache rather than re-running the aggregates', async () => {
    // The aggregate scans every Media row and the whole frequency list; a week
    // is the TTL because the numbers move on a weekly backfill.
    await seedWords([{ rank: 1, word: 'a', matchCount: 1 }]);
    const first = await request(app).get('/v1/stats/overview');

    await seedWords([
      { rank: 1, word: 'a', matchCount: 1 },
      { rank: 2, word: 'b', matchCount: 1 },
    ]);
    const second = await request(app).get('/v1/stats/overview');

    expect(second.body.totalFrequencyWords).toBe(first.body.totalFrequencyWords);
  });

  it('reports the translation split the stats page renders', async () => {
    await seedWords([{ rank: 1, word: 'a' }]);

    const res = await request(app).get('/v1/stats/overview');

    expect(res.body.translations).toMatchObject({
      total: expect.any(Number),
      enHuman: expect.any(Number),
      enMachine: expect.any(Number),
      esHuman: expect.any(Number),
      esMachine: expect.any(Number),
    });
  });
});

describe('GET /v1/stats/covered-words', () => {
  /** Ranks 1..n, every other word covered. */
  async function seedRange(n: number) {
    await seedWords(Array.from({ length: n }, (_, i) => ({ rank: i + 1, word: `w${i + 1}`, matchCount: i % 2 })));
  }

  it('lists the words in a tier in rank order', async () => {
    await seedRange(5);

    const res = await request(app).get('/v1/stats/covered-words').query({ tier: 5, take: 10 });

    expect(res.status).toBe(200);
    expect(res.body.words.map((w: { rank: number }) => w.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it('stops at the tier boundary', async () => {
    await seedRange(10);

    const res = await request(app).get('/v1/stats/covered-words').query({ tier: 3, take: 10 });

    expect(res.body.words.map((w: { rank: number }) => w.rank)).toEqual([1, 2, 3]);
  });

  it('starts after minRank, so a slice can be asked for', async () => {
    // `minRank=1000&tier=2000` is how the page requests one band at a time.
    await seedRange(10);

    const res = await request(app).get('/v1/stats/covered-words').query({ tier: 6, minRank: 3, take: 10 });

    expect(res.body.words.map((w: { rank: number }) => w.rank)).toEqual([4, 5, 6]);
  });

  it('continues from the cursor without repeating or skipping a rank', async () => {
    // The boundary is where a keyset paginator goes wrong, and it goes wrong
    // quietly: one row served twice or dropped, in the middle of a long list.
    await seedRange(10);

    const first = await request(app).get('/v1/stats/covered-words').query({ tier: 10, take: 4 });
    const second = await request(app)
      .get('/v1/stats/covered-words')
      .query({ tier: 10, take: 4, cursor: first.body.pagination.cursor });

    expect(first.body.words.map((w: { rank: number }) => w.rank)).toEqual([1, 2, 3, 4]);
    expect(second.body.words.map((w: { rank: number }) => w.rank)).toEqual([5, 6, 7, 8]);
  });

  it('reports no more pages, and no cursor, on the last one', async () => {
    await seedRange(6);

    const res = await request(app).get('/v1/stats/covered-words').query({ tier: 6, take: 10 });

    expect(res.body.pagination).toEqual({ hasMore: false, cursor: null });
  });

  it('reports more pages when the tier is longer than one', async () => {
    await seedRange(10);

    const res = await request(app).get('/v1/stats/covered-words').query({ tier: 10, take: 4 });

    expect(res.body.pagination.hasMore).toBe(true);
    expect(res.body.pagination.cursor).toEqual(expect.any(String));
  });

  it('never returns more than the page size, even though it reads one extra row', async () => {
    // The extra row is how `hasMore` is answered; leaking it would make every
    // page one longer than asked for.
    await seedRange(10);

    const res = await request(app).get('/v1/stats/covered-words').query({ tier: 10, take: 4 });

    expect(res.body.words).toHaveLength(4);
  });

  it.each([
    ['COVERED', (w: { matchCount: number }) => w.matchCount > 0],
    ['UNCOVERED', (w: { matchCount: number }) => w.matchCount === 0],
  ])('the %s filter returns only those words', async (filter, predicate) => {
    await seedRange(10);

    const res = await request(app).get('/v1/stats/covered-words').query({ tier: 10, take: 20, filter });

    expect(res.body.words.length).toBeGreaterThan(0);
    expect(res.body.words.every(predicate)).toBe(true);
  });

  it('the tier totals describe the whole tier, not the filtered page', async () => {
    // They are what the header says ("412 of 1000 covered"), so filtering to the
    // uncovered words must not change them.
    await seedRange(10);

    const unfiltered = await request(app).get('/v1/stats/covered-words').query({ tier: 10, take: 2 });
    const filtered = await request(app)
      .get('/v1/stats/covered-words')
      .query({ tier: 10, take: 2, filter: 'UNCOVERED' });

    expect(filtered.body.tierStats).toEqual(unfiltered.body.tierStats);
    expect(unfiltered.body.tierStats).toEqual({ total: 10, covered: 5, uncovered: 5 });
  });

  it('returns an empty page rather than an error for a tier with nothing in it', async () => {
    await seedWords([]);

    const res = await request(app).get('/v1/stats/covered-words').query({ tier: 1000, take: 10 });

    expect(res.status).toBe(200);
    expect(res.body.words).toEqual([]);
    expect(res.body.pagination).toEqual({ hasMore: false, cursor: null });
  });

  it('ignores a cursor that points behind minRank', async () => {
    // A stale cursor from a wider slice must not walk the reader back out of
    // the band they asked for.
    await seedRange(10);

    const first = await request(app).get('/v1/stats/covered-words').query({ tier: 10, take: 2 });
    const res = await request(app)
      .get('/v1/stats/covered-words')
      .query({ tier: 10, minRank: 6, take: 10, cursor: first.body.pagination.cursor });

    expect(res.body.words.map((w: { rank: number }) => w.rank)).toEqual([7, 8, 9, 10]);
  });
});

describe('POST /v1/stats/covered-words/update', () => {
  it('records how many words it checked and how many newly matched', async () => {
    await seedWords([
      { rank: 1, word: 'する', matchCount: 0 },
      { rank: 2, word: 'いる', matchCount: 0 },
    ]);
    wordsCoverageCount.mockResolvedValue(new Map([['する', 12]]));

    const res = await request(app).post('/v1/stats/covered-words/update').send({ maxRank: 10 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ wordsChecked: 2, newlyCovered: 1, totalCovered: 1, percentage: 50 });
  });

  it('writes the counts back, so the next read sees them', async () => {
    await seedWords([{ rank: 1, word: 'する', matchCount: 0 }]);
    wordsCoverageCount.mockResolvedValue(new Map([['する', 12]]));

    await request(app).post('/v1/stats/covered-words/update').send({ maxRank: 10 });

    const [row] = await WordFrequency.query('SELECT match_count FROM "WordFrequency" WHERE rank = 1');
    expect(row.match_count).toBe(12);
  });

  it('does not count a word that was already covered as newly covered', async () => {
    // `newlyCovered` is the number the weekly job is judged on; counting
    // re-confirmations would make a no-op run look like progress.
    await seedWords([{ rank: 1, word: 'する', matchCount: 5 }]);
    wordsCoverageCount.mockResolvedValue(new Map([['する', 12]]));

    const res = await request(app).post('/v1/stats/covered-words/update').send({ maxRank: 10 });

    expect(res.body.newlyCovered).toBe(0);
    expect(res.body.totalCovered).toBe(1);
  });

  it('clears a word whose matches have gone away', async () => {
    // Segments get hidden and deleted, so coverage can go DOWN. Only ever
    // adding would leave the page claiming a word is covered by nothing.
    await seedWords([{ rank: 1, word: 'する', matchCount: 5 }]);
    wordsCoverageCount.mockResolvedValue(new Map());

    await request(app).post('/v1/stats/covered-words/update').send({ maxRank: 10 });

    const [row] = await WordFrequency.query('SELECT match_count FROM "WordFrequency" WHERE rank = 1');
    expect(row.match_count).toBe(0);
  });

  it('only visits uncovered words when asked to', async () => {
    // The weekly full run is expensive; the incremental one exists to skip the
    // words that already have an answer.
    await seedWords([
      { rank: 1, word: 'covered', matchCount: 5 },
      { rank: 2, word: 'uncovered', matchCount: 0 },
    ]);

    const res = await request(app).post('/v1/stats/covered-words/update').send({ maxRank: 10, onlyUncovered: true });

    expect(res.body.wordsChecked).toBe(1);
    expect(wordsCoverageCount.mock.calls[0]![0]).toEqual(['uncovered']);
  });

  it('stops at maxRank rather than walking the whole list', async () => {
    await seedWords([
      { rank: 1, word: 'a' },
      { rank: 5000, word: 'b' },
    ]);

    const res = await request(app).post('/v1/stats/covered-words/update').send({ maxRank: 100 });

    expect(res.body.wordsChecked).toBe(1);
  });

  it('returns zeroes rather than dividing by zero when there is nothing to check', async () => {
    await seedWords([]);

    const res = await request(app).post('/v1/stats/covered-words/update').send({ maxRank: 10 });

    expect(res.body).toEqual({ wordsChecked: 0, newlyCovered: 0, totalCovered: 0, percentage: 0 });
  });

  it('a failed batch does not abandon the rest of the run', async () => {
    // The index can refuse one query -- a timeout, a circuit breaker -- and
    // losing the whole weekly run to that would mean waiting another week.
    await seedWords([{ rank: 1, word: 'する', matchCount: 0 }]);
    wordsCoverageCount.mockRejectedValue(new Error('elasticsearch timeout'));

    const res = await request(app).post('/v1/stats/covered-words/update').send({ maxRank: 10 });

    expect(res.status).toBe(200);
    expect(res.body.newlyCovered).toBe(0);
  });

  it('invalidates the overview cache, so the new numbers are visible immediately', async () => {
    // Without this the stats page keeps showing last week's coverage for a
    // week after the job that fixed it.
    await seedWords([{ rank: 1, word: 'する', matchCount: 0 }]);
    const before = await request(app).get('/v1/stats/overview');
    expect(before.body.tiers[0].covered).toBe(0);

    wordsCoverageCount.mockResolvedValue(new Map([['する', 12]]));
    await request(app).post('/v1/stats/covered-words/update').send({ maxRank: 10 });

    const after = await request(app).get('/v1/stats/overview');
    expect(after.body.tiers[0].covered).toBe(1);
  });

  it('only asks the index about words that are safe to count', async () => {
    // Coverage means "a reader can find this word in a sentence", so hidden
    // segments and categories the site does not surface must not count.
    await seedWords([{ rank: 1, word: 'する', matchCount: 0 }]);

    await request(app).post('/v1/stats/covered-words/update').send({ maxRank: 10 });

    expect(wordsCoverageCount.mock.calls[0]![1]).toEqual({ category: ['ANIME', 'JDRAMA'], status: ['ACTIVE'] });
  });
});
