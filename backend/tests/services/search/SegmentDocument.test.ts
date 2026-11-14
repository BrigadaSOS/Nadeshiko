import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SegmentDocument } from '@app/services/search/SegmentDocument';
import { client } from '@config/elasticsearch';
import { InvalidRequestError } from '@app/errors';
import { decodeKeysetCursor, encodeKeysetCursor } from '@lib/cursor';
import { CategoryType, WordFrequency } from '@app/models';
import type { SlimToken } from '@app/models/Segment';
import { resetDifficultyLookup } from '@app/services/search/segmentDocument/difficultyLookup';
import { Cache } from '@lib/cache';
import { MEDIA_INFO_CACHE } from '@app/models/Media';
import { setupSearchSuite } from '../../helpers/searchSetup';
import { isEsAvailable, seedSegmentsIntoEs } from '../../helpers/esFixtures';
import { surroundingSegments } from '@app/services/search/segmentDocument/SegmentContext';

vi.mock('@config/log', () => {
  const noop = () => {};
  const mockLogger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => mockLogger,
  };
  return { logger: mockLogger, createLogger: () => mockLogger, default: mockLogger };
});

const esAvailable = await isEsAvailable();

describe.skipIf(!esAvailable)('SegmentDocument (integration)', () => {
  setupSearchSuite();

  beforeEach(() => {
    Cache.invalidate(MEDIA_INFO_CACHE);
    // Round lists are keyed by the query, which is the same across tests that search the same word; a list left by a
    // previous test points at segments that no longer exist.
    Cache.invalidate(SegmentDocument.VARIETY_ROUNDS_CACHE);
  });

  describe('search()', () => {
    it('finds segment by Japanese text', async () => {
      await seedSegmentsIntoEs({}, [{ contentJa: 'こんにちは世界' }]);

      const result = await SegmentDocument.search({
        query: { search: 'こんにちは', exactMatch: false },
        take: 25,
      });

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].textJa.content).toBe('こんにちは世界');
      expect(result.segments[0].textJa.highlight).toContain('こんにちは');
      expect(result.includes?.media).toBeDefined();
    });

    it('finds segment by Japanese baseform (食べました → 食べる)', async () => {
      await seedSegmentsIntoEs({}, [{ contentJa: '昨日ラーメンを食べました' }]);

      const result = await SegmentDocument.search({
        query: { search: '食べる', exactMatch: false },
        take: 25,
      });

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].textJa.content).toBe('昨日ラーメンを食べました');
    });

    // Katakana queries must skip the broken kana field; otherwise empty-reading tokens match unrelated segments instead
    // of only the surface/baseform/normalized fields.
    it('katakana with empty-reading chars: only returns matching segments', async () => {
      // Seed one target + 3 distractors that have empty kana tokens
      await seedSegmentsIntoEs({}, [{ contentJa: 'アイメイが話しています' }]);
      await seedSegmentsIntoEs({}, [{ contentJa: 'バカッ' }]);
      await seedSegmentsIntoEs({}, [{ contentJa: 'ウケッ' }]);
      await seedSegmentsIntoEs({}, [{ contentJa: 'レロレロ' }]);

      // Without the fix, empty kana tokens match all four docs; with it, the surface query returns one.
      const result = await SegmentDocument.search({
        query: { search: 'アイメイ', exactMatch: false },
        take: 4,
      });

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].textJa.content).toBe('アイメイが話しています');
    });

    it('finds segment by English text', async () => {
      await seedSegmentsIntoEs({}, [{ contentJa: 'テスト', contentEn: 'Hello world' }]);

      const result = await SegmentDocument.search({
        query: { search: 'Hello', exactMatch: false },
        take: 25,
      });

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].textEn?.content).toBe('Hello world');
    });

    // The kana clause previously re-admitted てる conjugations because each language tokenized exclusion independently;
    // retain plain forms too so exclusion stays script-agnostic.
    it('exclusion operator removes every conjugation and script of the excluded term', async () => {
      await seedSegmentsIntoEs({}, [{ contentJa: '少しズレがある' }]);
      await seedSegmentsIntoEs({}, [{ contentJa: '時計がずれてる' }]);
      await seedSegmentsIntoEs({}, [{ contentJa: '時計がズレてる' }]);
      await seedSegmentsIntoEs({}, [{ contentJa: 'ズレて困った' }]);
      await seedSegmentsIntoEs({}, [{ contentJa: '時計がずれて困る' }]);

      const result = await SegmentDocument.search({
        query: { search: '"ズレ" -ズレて', exactMatch: false },
        take: 25,
      });

      expect(result.segments.map((segment) => segment.textJa.content)).toEqual(['少しズレがある']);
    });

    it('treats a hyphen inside a word as text, not as an exclusion', async () => {
      await seedSegmentsIntoEs({}, [{ contentJa: 'テスト', contentEn: 'a well-known result' }]);

      const result = await SegmentDocument.search({
        query: { search: 'well-known', exactMatch: false },
        take: 25,
      });

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].textEn?.content).toBe('a well-known result');
    });

    it('filters by category', async () => {
      await seedSegmentsIntoEs({ category: CategoryType.ANIME }, [{ contentJa: 'アニメセグメント' }]);
      await seedSegmentsIntoEs({ category: CategoryType.JDRAMA }, [{ contentJa: 'ドラマセグメント' }]);

      const animeResult = await SegmentDocument.search({
        query: { search: 'セグメント', exactMatch: false },
        take: 25,
        filters: { status: ['ACTIVE'], category: ['ANIME'] },
      });

      expect(animeResult.segments).toHaveLength(1);
      expect(animeResult.segments[0].textJa.content).toBe('アニメセグメント');

      const jdramaResult = await SegmentDocument.search({
        query: { search: 'セグメント', exactMatch: false },
        take: 25,
        filters: { status: ['ACTIVE'], category: ['JDRAMA'] },
      });

      expect(jdramaResult.segments).toHaveLength(1);
      expect(jdramaResult.segments[0].textJa.content).toBe('ドラマセグメント');
    });

    it('filters by media include', async () => {
      const { media: media1 } = await seedSegmentsIntoEs({}, [{ contentJa: '含む特別文章' }]);
      await seedSegmentsIntoEs({}, [{ contentJa: '除外特別文章' }]);

      const result = await SegmentDocument.search({
        query: { search: '特別', exactMatch: false },
        take: 25,
        filters: {
          status: ['ACTIVE'],
          category: ['ANIME'],
          media: { include: [{ mediaPublicId: media1.publicId, mediaId: media1.id }] },
        },
      });

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].textJa.content).toBe('含む特別文章');
    });

    it('supports keyset pagination', async () => {
      await seedSegmentsIntoEs({}, [
        { contentJa: '猫が好きです', position: 1 },
        { contentJa: '猫は可愛い', position: 2 },
        { contentJa: '猫と遊ぶ', position: 3 },
      ]);

      const page1 = await SegmentDocument.search({
        query: { search: '猫', exactMatch: false },
        take: 1,
      });

      expect(page1.segments).toHaveLength(1);
      expect(page1.pagination.hasMore).toBe(true);
      expect(page1.pagination.cursor).toBeTruthy();

      const page2 = await SegmentDocument.search({
        query: { search: '猫', exactMatch: false },
        take: 1,
        cursor: page1.pagination.cursor as string,
      });

      expect(page2.segments).toHaveLength(1);
      expect(page2.segments[0].publicId).not.toBe(page1.segments[0].publicId);
    });

    describe('difficulty sort', () => {
      const word = (d: string, b: number, p = '名詞'): SlimToken => ({
        s: d,
        d,
        r: '',
        b,
        e: b + d.length,
        p,
        kind: 'word',
      });
      const particle = (s: string, b: number): SlimToken => ({
        s,
        d: s,
        r: '',
        b,
        e: b + 1,
        p: '助詞',
        kind: 'function',
      });

      beforeEach(async () => {
        await WordFrequency.query('DELETE FROM "WordFrequency"');
        await WordFrequency.query(
          `INSERT INTO "WordFrequency" (rank, word, form) VALUES
             (50, '見る', 'みる'), (80, '来る', 'くる'), (100, '猫', 'ねこ'), (120, '好き', 'すき'),
             (300, '使う', 'つかう'), (5000, '魔法', 'まほう')`,
        );
        resetDifficultyLookup();
      });

      afterEach(async () => {
        await WordFrequency.query('DELETE FROM "WordFrequency"');
        resetDifficultyLookup();
      });

      /** Three full sentences: easy (common words only), middle (an unknown name, which counts as a rank-5,000 word)
       * and hard (魔法 at rank 5,000 plus 使う, which beats the name line on the second word). Then a one-word line,
       * which goes after every full sentence, and two lines with no tokens at all, which go last in both directions
       * and among themselves by length. */
      async function seedByDifficulty() {
        await seedSegmentsIntoEs({}, [
          {
            contentJa: '猫が魔法を使う',
            tokens: [word('猫', 0), particle('が', 1), word('魔法', 2), particle('を', 4), word('使う', 5, '動詞')],
          },
          { contentJa: '猫だ', tokens: [word('猫', 0), { ...particle('だ', 1), p: '助動詞' }] },
          { contentJa: '猫の鳴き声', tokens: null },
          { contentJa: '猫がいる', tokens: null },
          {
            contentJa: '猫を見るのが好きだ',
            tokens: [
              word('猫', 0),
              particle('を', 1),
              word('見る', 2, '動詞'),
              particle('の', 4),
              particle('が', 5),
              word('好き', 6, '形状詞'),
              { ...particle('だ', 8), p: '助動詞' },
            ],
          },
          {
            contentJa: '猫とルーデウスが来た',
            tokens: [
              word('猫', 0),
              particle('と', 1),
              word('ルーデウス', 2),
              particle('が', 7),
              { ...word('来る', 8, '動詞'), s: '来' },
              { ...particle('た', 9), p: '助動詞' },
            ],
          },
        ]);
      }

      async function walk(mode: 'DIFFICULTY_ASC' | 'DIFFICULTY_DESC'): Promise<string[]> {
        const seen: string[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 10; page++) {
          const result = await SegmentDocument.search({
            query: { search: '猫', exactMatch: false },
            sort: { mode },
            take: 1,
            ...(cursor ? { cursor } : {}),
          });
          seen.push(...result.segments.map((s) => s.textJa.content));
          if (!result.pagination.hasMore || !result.pagination.cursor) break;
          cursor = result.pagination.cursor;
        }
        return seen;
      }

      it('pages easiest first: full sentences, then the one-word line, then the unscored ones', async () => {
        await seedByDifficulty();

        expect(await walk('DIFFICULTY_ASC')).toEqual([
          '猫を見るのが好きだ',
          '猫とルーデウスが来た',
          '猫が魔法を使う',
          '猫だ',
          '猫がいる',
          '猫の鳴き声',
        ]);
      });

      it('pages hardest first, still with the one-word and unscored lines after the full sentences', async () => {
        await seedByDifficulty();

        expect(await walk('DIFFICULTY_DESC')).toEqual([
          '猫が魔法を使う',
          '猫とルーデウスが来た',
          '猫を見るのが好きだ',
          '猫だ',
          '猫の鳴き声',
          '猫がいる',
        ]);
      });

      it('resumes from a cursor issued on an unscored line', async () => {
        await seedByDifficulty();
        const request = { query: { search: '猫', exactMatch: false }, sort: { mode: 'DIFFICULTY_ASC' as const } };

        const first = await SegmentDocument.search({ ...request, take: 5 });
        const values = decodeKeysetCursor<unknown[]>(first.pagination.cursor ?? undefined) ?? [];
        const rest = await SegmentDocument.search({ ...request, take: 5, cursor: first.pagination.cursor as string });

        expect(first.segments.at(-1)?.textJa.content).toBe('猫がいる');
        // The explicit missing values (fragment, then difficulty), not `_last`'s Long.MAX_VALUE, which a JSON number
        // cannot carry.
        expect(values.slice(0, 2)).toEqual([1, 32767]);
        expect(values.every((value) => Number.isSafeInteger(value))).toBe(true);
        expect(rest.segments.map((s) => s.textJa.content)).toEqual(['猫の鳴き声']);
      });

      it('changes the order, not the matches', async () => {
        await seedByDifficulty();

        const [byRelevance, byDifficulty] = await Promise.all([
          SegmentDocument.search({ query: { search: '猫', exactMatch: false }, take: 25 }),
          SegmentDocument.search({
            query: { search: '猫', exactMatch: false },
            sort: { mode: 'DIFFICULTY_DESC' },
            take: 25,
          }),
        ]);

        expect(byDifficulty.segments.map((s) => s.publicId).sort()).toEqual(
          byRelevance.segments.map((s) => s.publicId).sort(),
        );
      });
    });

    describe('rounds by title (default order)', () => {
      /**
       * One title (A) that dominates the word with short, high-scoring lines,
       * and two titles (B, C) with one longer line each. Plain relevance puts
       * all of A first; rounds put B and C right after A's best line.
       */
      async function seedDominatedWord() {
        const a = await seedSegmentsIntoEs({}, [
          { contentJa: '猫が好き' },
          { contentJa: '猫は可愛い' },
          { contentJa: '猫と遊ぶ' },
          { contentJa: '猫を見た' },
        ]);
        const b = await seedSegmentsIntoEs({}, [{ contentJa: '今日は公園でとても大きな猫を見ました' }]);
        const c = await seedSegmentsIntoEs({}, [{ contentJa: '昨日は友達の家でとても小さな猫と遊びました' }]);
        return { a: a.media.publicId, b: b.media.publicId, c: c.media.publicId, aId: a.media.id, cId: c.media.id };
      }

      const searchCat = (extra: Record<string, unknown> = {}, starred?: ReadonlySet<number>) =>
        SegmentDocument.search(
          { query: { search: '猫', exactMatch: false }, take: 25, ...extra } as never,
          'strict',
          starred,
        );

      it('serves every sentence of a starred title first, then the other titles in rounds', async () => {
        const { a, b, c, aId } = await seedDominatedWord();

        const titles = (await searchCat({}, new Set([aId]))).segments.map((s) => s.mediaPublicId);

        // A is starred: all four of its lines lead, then B and C.
        expect(titles.slice(0, 4)).toEqual([a, a, a, a]);
        expect(new Set(titles.slice(4))).toEqual(new Set([b, c]));
      });

      it('keeps a starred title ahead even when another title has the better lines', async () => {
        const { a, c, cId } = await seedDominatedWord();

        const titles = (await searchCat({}, new Set([cId]))).segments.map((s) => s.mediaPublicId);

        expect(titles[0]).toBe(c);
        expect(titles[1]).toBe(a);
        expect(titles).toHaveLength(6);
      });

      it('pages through a starred search exactly once each, whatever the page size', async () => {
        const { aId, cId } = await seedDominatedWord();
        const starred = new Set([aId, cId]);
        const all = (await searchCat({}, starred)).segments.map((s) => s.publicId);
        expect(new Set(all).size).toBe(6);

        for (const take of [1, 2, 4]) {
          const paged: string[] = [];
          let cursor: string | undefined;
          for (let page = 0; page < 20; page++) {
            const result = await searchCat({ take, ...(cursor ? { cursor } : {}) }, starred);
            paged.push(...result.segments.map((s) => s.publicId));
            if (!result.pagination.hasMore || !result.pagination.cursor) break;
            cursor = result.pagination.cursor;
          }
          expect(paged).toEqual(all);
        }
      });

      it('survives the round list being rebuilt between pages', async () => {
        await seedDominatedWord();
        const all = (await searchCat()).segments.map((s) => s.publicId);

        const paged: string[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 20; page++) {
          Cache.invalidate(SegmentDocument.VARIETY_ROUNDS_CACHE);
          const result = await searchCat({ take: 2, ...(cursor ? { cursor } : {}) });
          paged.push(...result.segments.map((s) => s.publicId));
          if (!result.pagination.hasMore || !result.pagination.cursor) break;
          cursor = result.pagination.cursor;
        }
        expect(paged).toEqual(all);
      });

      it('puts the best line of every title first, then the second best', async () => {
        const { a, b, c } = await seedDominatedWord();

        const result = await searchCat();
        const titles = result.segments.map((s) => s.mediaPublicId);

        expect(titles).toHaveLength(6);
        expect(titles[0]).toBe(a);
        expect(new Set(titles.slice(0, 3))).toEqual(new Set([a, b, c]));
        // Round 2 is A's second line; then the rest of A.
        expect(titles.slice(3)).toEqual([a, a, a]);
        expect(new Set(result.segments.map((s) => s.publicId)).size).toBe(6);
      });

      it('pages through every sentence exactly once, in the same order, whatever the page size', async () => {
        await seedDominatedWord();
        const all = (await searchCat()).segments.map((s) => s.publicId);

        for (const take of [1, 2, 4]) {
          const paged: string[] = [];
          let cursor: string | undefined;
          for (let page = 0; page < 20; page++) {
            const result = await searchCat({ take, ...(cursor ? { cursor } : {}) });
            paged.push(...result.segments.map((s) => s.publicId));
            if (!result.pagination.hasMore || !result.pagination.cursor) break;
            cursor = result.pagination.cursor;
          }
          expect(paged).toEqual(all);
        }
      });

      it('keeps an explicit sort exactly as asked', async () => {
        const { a } = await seedDominatedWord();

        const result = await searchCat({ sort: { mode: 'asc' } });
        // Shortest first: all four of A's short lines lead, unmixed.
        expect(result.segments.slice(0, 4).map((s) => s.mediaPublicId)).toEqual([a, a, a, a]);
      });

      it('keeps honouring a keyset cursor issued before rounds existed', async () => {
        const { a } = await seedDominatedWord();

        // A score above any real one: "everything after the top", in plain relevance order -- A's short lines lead,
        // where rounds would put B and C right after A's best.
        const result = await searchCat({ take: 3, cursor: encodeKeysetCursor([1e9, 0, 0, 0, 0]) });
        expect(result.segments.map((s) => s.mediaPublicId)).toEqual([a, a, a]);
        // And it hands back a plain keyset cursor, so the rest of that scroll stays in the old order too.
        expect(decodeKeysetCursor(result.pagination.cursor ?? undefined)).toHaveLength(5);
      });
    });

    it('filters by segmentLengthChars', async () => {
      await seedSegmentsIntoEs({}, [
        { contentJa: '短い', position: 1 },
        { contentJa: 'これはもっと長い日本語のセグメントです', position: 2 },
      ]);

      const result = await SegmentDocument.search({
        query: { exactMatch: false },
        take: 25,
        filters: { status: ['ACTIVE'], category: ['ANIME'], segmentLengthChars: { min: 10 } },
      });

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].textJa.content).toBe('これはもっと長い日本語のセグメントです');
    });

    it('returns empty results for no hits', async () => {
      const result = await SegmentDocument.search({
        query: { search: '存在しない検索語', exactMatch: false },
        take: 25,
      });

      expect(result.segments).toHaveLength(0);
      expect(result.pagination.hasMore).toBe(false);
    });
  });

  describe('searchStats()', () => {
    it('keeps category totals unscoped when media statistics are narrowed to one title', async () => {
      const selected = await seedSegmentsIntoEs({ category: CategoryType.ANIME }, [{ contentJa: '全体集計テスト' }]);
      await seedSegmentsIntoEs({ category: CategoryType.ANIME }, [{ contentJa: '全体集計テスト' }]);

      const result = await SegmentDocument.searchStats({
        query: { search: '全体集計', exactMatch: false },
        filters: {
          status: ['ACTIVE'],
          category: ['ANIME'],
          media: { include: [{ mediaPublicId: selected.media.publicId, mediaId: selected.media.id } as any] },
        },
      });

      expect(result.media).toHaveLength(1);
      expect(result.media[0]?.mediaPublicId).toBe(selected.media.publicId);
      expect(result.categories.find((category) => category.category === 'ANIME')?.count).toBe(2);
    });

    it('returns media and category aggregation stats', async () => {
      await seedSegmentsIntoEs({ category: CategoryType.ANIME }, [
        { contentJa: '統計テスト', position: 1 },
        { contentJa: '統計テスト二', position: 2 },
      ]);
      await seedSegmentsIntoEs({ category: CategoryType.JDRAMA }, [{ contentJa: '統計テストドラマ' }]);

      const result = await SegmentDocument.searchStats({
        query: { search: '統計', exactMatch: false },
      });

      expect(result.media.length).toBeGreaterThanOrEqual(1);
      expect(result.categories.length).toBeGreaterThanOrEqual(1);

      const animeCategory = result.categories.find((c) => c.category === 'ANIME');
      const jdramaCategory = result.categories.find((c) => c.category === 'JDRAMA');
      expect(animeCategory).toBeDefined();
      expect(animeCategory?.count).toBe(2);
      expect(animeCategory?.realCount).toBe(animeCategory?.count);
      expect(jdramaCategory).toBeDefined();
      expect(jdramaCategory?.count).toBe(1);
      expect(jdramaCategory?.realCount).toBe(jdramaCategory?.count);
    });

    // The reported counts came from a separate aggregation query, so an exclusion the
    // hit list honoured could still be missing from the number above it. Both paths go
    // through buildSearchMust; this pins that down.
    it('applies the exclusion operator to the aggregated counts too', async () => {
      await seedSegmentsIntoEs({ category: CategoryType.ANIME }, [
        { contentJa: '少しズレがある', position: 1 },
        { contentJa: '時計がずれてる', position: 2 },
      ]);

      const result = await SegmentDocument.searchStats({
        query: { search: '"ズレ" -ズレて', exactMatch: false },
      });

      expect(result.categories.find((c) => c.category === 'ANIME')?.count).toBe(1);
    });

    it('returns realCount while excluding hidden media from visible counts', async () => {
      await seedSegmentsIntoEs({ category: CategoryType.ANIME }, [
        { contentJa: '統計可視テスト一', position: 1 },
        { contentJa: '統計可視テスト二', position: 2 },
      ]);
      const hidden = await seedSegmentsIntoEs({ category: CategoryType.ANIME }, [
        { contentJa: '統計非表示テスト一', position: 1 },
        { contentJa: '統計非表示テスト二', position: 2 },
        { contentJa: '統計非表示テスト三', position: 3 },
      ]);

      const result = await SegmentDocument.searchStats({
        query: { search: '統計', exactMatch: false },
        filters: {
          status: ['ACTIVE'],
          category: ['ANIME', 'JDRAMA'],
          media: {
            exclude: [{ mediaPublicId: hidden.media.publicId, mediaId: hidden.media.id } as any],
          },
        },
      });

      const animeCategory = result.categories.find((c) => c.category === 'ANIME');
      expect(animeCategory).toBeDefined();
      expect(animeCategory?.count).toBe(2);
      expect(animeCategory?.realCount).toBe(5);

      // Hidden media is excluded from per-media buckets but its segments count toward `realCount`.
      expect(result.media.find((m) => m.mediaPublicId === hidden.media.publicId)).toBeUndefined();
    });
  });

  describe('wordsMatched()', () => {
    it('returns per-word match counts', async () => {
      await seedSegmentsIntoEs({}, [
        { contentJa: '猫が好きです', position: 1 },
        { contentJa: '犬も好きです', position: 2 },
      ]);

      const result = await SegmentDocument.wordsMatched(['猫', '犬', 'xyz不存在'], false);

      expect(result.results).toHaveLength(3);

      const catResult = result.results.find((r) => r.word === '猫');
      expect(catResult?.isMatch).toBe(true);
      expect(catResult?.matchCount).toBeGreaterThanOrEqual(1);
      expect(catResult?.realMatchCount).toBe(catResult?.matchCount);

      const dogResult = result.results.find((r) => r.word === '犬');
      expect(dogResult?.isMatch).toBe(true);
      expect(dogResult?.matchCount).toBeGreaterThanOrEqual(1);
      expect(dogResult?.realMatchCount).toBe(dogResult?.matchCount);

      const noMatch = result.results.find((r) => r.word === 'xyz不存在');
      expect(noMatch?.isMatch).toBe(false);
      expect(noMatch?.matchCount).toBe(0);
      expect(noMatch?.realMatchCount).toBe(0);
    });

    it('returns real counts while excluding hidden media from visible counts', async () => {
      await seedSegmentsIntoEs({}, [
        { contentJa: '猫が好きです', position: 1 },
        { contentJa: '猫は可愛いです', position: 2 },
      ]);
      const hidden = await seedSegmentsIntoEs({}, [
        { contentJa: '猫を見ました', position: 1 },
        { contentJa: '猫と遊びます', position: 2 },
        { contentJa: '猫ですね', position: 3 },
      ]);

      const result = await SegmentDocument.wordsMatched(['猫'], false, {
        status: ['ACTIVE'],
        category: ['ANIME', 'JDRAMA'],
        media: {
          exclude: [{ mediaPublicId: hidden.media.publicId, mediaId: hidden.media.id } as any],
        },
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        word: '猫',
        isMatch: true,
        matchCount: 2,
        realMatchCount: 5,
      });
    });
  });

  describe('surroundingSegments()', () => {
    it('returns sorted context around a position', async () => {
      const { media } = await seedSegmentsIntoEs({}, [
        { contentJa: '前のセグメント', position: 1 },
        { contentJa: '中央セグメント', position: 2 },
        { contentJa: '後のセグメント', position: 3 },
      ]);

      const result = await surroundingSegments({
        mediaId: media.id,
        episodeNumber: 1,
        segmentPosition: 2,
      });

      expect(result.segments.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < result.segments.length; i++) {
        expect(result.segments[i].position).toBeGreaterThanOrEqual(result.segments[i - 1].position);
      }
      expect(result.includes?.media).toBeDefined();
    });
  });
});

describe('SegmentDocument (mocked)', () => {
  describe('error handling', () => {
    it('retries with safe parser on query syntax error', async () => {
      const searchSpy = vi.spyOn(client, 'search');
      const { Media } = await import('@app/models');
      const mockMediaInfo = {
        results: new Map(),
        stats: { totalAnimes: 0, totalSegments: 0, fullTotalAnimes: 0, fullTotalSegments: 0 },
      };
      const getMediaInfoMapSpy = vi.spyOn(Media, 'getMediaInfoMap').mockResolvedValue(mockMediaInfo as any);

      const parseError = new Error('search failed') as any;
      parseError.meta = {
        body: { error: { type: 'parse_exception', reason: 'failed to parse query' } },
      };
      searchSpy.mockRejectedValueOnce(parseError).mockResolvedValue({
        took: 5,
        timed_out: false,
        _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
        hits: { total: { value: 0, relation: 'eq' }, max_score: null, hits: [] },
      } as any);

      const result = await SegmentDocument.search({
        query: { search: 'bad(query', exactMatch: false },
        take: 25,
      });

      expect(result.segments).toHaveLength(0);
      // The strict round query fails; the safe retry computes the (empty) rounds and then the rest page.
      expect(searchSpy).toHaveBeenCalledTimes(3);
      const strictQuery = JSON.stringify((searchSpy.mock.calls[0]?.[0] as any)?.query);
      const safeQuery = JSON.stringify((searchSpy.mock.calls[1]?.[0] as any)?.query);
      expect(safeQuery).not.toEqual(strictQuery);

      searchSpy.mockRestore();
      getMediaInfoMapSpy.mockRestore();
    });

    it('throws InvalidRequestError on cursor length mismatch', async () => {
      const badCursor = encodeKeysetCursor([1.0]);

      await expect(
        SegmentDocument.search({
          query: { search: 'test', exactMatch: false },
          take: 25,
          cursor: badCursor,
        }),
      ).rejects.toThrow(InvalidRequestError);
    });

    it('throws InvalidRequestError when segmentLengthChars.min > max', async () => {
      await expect(
        SegmentDocument.search({
          query: { search: 'test', exactMatch: false },
          take: 25,
          filters: {
            status: ['ACTIVE'],
            category: ['ANIME'],
            segmentLengthChars: { min: 50, max: 10 },
          },
        }),
      ).rejects.toThrow(InvalidRequestError);
    });
  });
});
