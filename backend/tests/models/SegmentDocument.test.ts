import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { SegmentDocument } from '@app/models/SegmentDocument';
import { client } from '@config/elasticsearch';
import { InvalidRequestError } from '@app/errors';
import { SegmentIndexer } from '@app/models/segmentDocument/SegmentIndexer';
import { encodeKeysetCursor } from '@lib/cursor';
import { CategoryType } from '@app/models';
import { Cache } from '@lib/cache';
import { MEDIA_INFO_CACHE } from '@app/models/Media';
import { setupSearchSuite } from '../helpers/searchSetup';
import { isEsAvailable, seedSegmentsIntoEs } from '../helpers/esFixtures';

vi.mock('@config/log', () => {
  const noop = () => {};
  const mockLogger = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop, child: () => mockLogger };
  return { logger: mockLogger, createLogger: () => mockLogger, default: mockLogger };
});

const esAvailable = await isEsAvailable();

describe.skipIf(!esAvailable)('SegmentDocument (integration)', () => {
  setupSearchSuite();

  beforeEach(() => {
    Cache.invalidate(MEDIA_INFO_CACHE);
  });

  describe('search()', () => {
    it('finds segment by Japanese text', async () => {
      await seedSegmentsIntoEs({}, [{ contentJa: 'こんにちは世界' }]);

      const result = await SegmentDocument.search({
        query: { search: 'こんにちは' },
        take: 25,
      });

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].textJa.content).toBe('こんにちは世界');
      expect(result.segments[0].textJa.highlight).toContain('こんにちは');
      expect(result.includes.media).toBeDefined();
    });

    it('finds segment by Japanese baseform (食べました → 食べる)', async () => {
      await seedSegmentsIntoEs({}, [{ contentJa: '昨日ラーメンを食べました' }]);

      const result = await SegmentDocument.search({
        query: { search: '食べる' },
        take: 25,
      });

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].textJa.content).toBe('昨日ラーメンを食べました');
    });

    it('finds segment by English text', async () => {
      await seedSegmentsIntoEs({}, [{ contentJa: 'テスト', contentEn: 'Hello world' }]);

      const result = await SegmentDocument.search({
        query: { search: 'Hello' },
        take: 25,
      });

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].textEn!.content).toBe('Hello world');
    });

    it('filters by category', async () => {
      await seedSegmentsIntoEs({ category: CategoryType.ANIME }, [{ contentJa: 'アニメセグメント' }]);
      await seedSegmentsIntoEs({ category: CategoryType.JDRAMA }, [{ contentJa: 'ドラマセグメント' }]);

      const animeResult = await SegmentDocument.search({
        query: { search: 'セグメント' },
        take: 25,
        filters: { status: ['ACTIVE'], category: ['ANIME'] },
      });

      expect(animeResult.segments).toHaveLength(1);
      expect(animeResult.segments[0].textJa.content).toBe('アニメセグメント');

      const jdramaResult = await SegmentDocument.search({
        query: { search: 'セグメント' },
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
        query: { search: '特別' },
        take: 25,
        filters: { status: ['ACTIVE'], category: ['ANIME'], media: { include: [{ mediaId: media1.id }] } },
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
        query: { search: '猫' },
        take: 1,
      });

      expect(page1.segments).toHaveLength(1);
      expect(page1.pagination.hasMore).toBe(true);
      expect(page1.pagination.cursor).toBeTruthy();

      const page2 = await SegmentDocument.search({
        query: { search: '猫' },
        take: 1,
        cursor: page1.pagination.cursor!,
      });

      expect(page2.segments).toHaveLength(1);
      expect(page2.segments[0].uuid).not.toBe(page1.segments[0].uuid);
    });

    it('filters by segmentLengthChars', async () => {
      await seedSegmentsIntoEs({}, [
        { contentJa: '短い', position: 1 },
        { contentJa: 'これはもっと長い日本語のセグメントです', position: 2 },
      ]);

      const result = await SegmentDocument.search({
        query: {},
        take: 25,
        filters: { status: ['ACTIVE'], category: ['ANIME'], segmentLengthChars: { min: 10 } },
      });

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].textJa.content).toBe('これはもっと長い日本語のセグメントです');
    });

    it('returns empty results for no hits', async () => {
      const result = await SegmentDocument.search({
        query: { search: '存在しない検索語' },
        take: 25,
      });

      expect(result.segments).toHaveLength(0);
      expect(result.pagination.hasMore).toBe(false);
    });
  });

  describe('searchStats()', () => {
    it('returns media and category aggregation stats', async () => {
      await seedSegmentsIntoEs({ category: CategoryType.ANIME }, [
        { contentJa: '統計テスト', position: 1 },
        { contentJa: '統計テスト二', position: 2 },
      ]);
      await seedSegmentsIntoEs({ category: CategoryType.JDRAMA }, [
        { contentJa: '統計テストドラマ' },
      ]);

      const result = await SegmentDocument.searchStats({
        query: { search: '統計' },
      });

      expect(result.media.length).toBeGreaterThanOrEqual(1);
      expect(result.categories.length).toBeGreaterThanOrEqual(1);

      const animeCategory = result.categories.find((c) => c.category === 'ANIME');
      const jdramaCategory = result.categories.find((c) => c.category === 'JDRAMA');
      expect(animeCategory).toBeDefined();
      expect(animeCategory!.count).toBe(2);
      expect(jdramaCategory).toBeDefined();
      expect(jdramaCategory!.count).toBe(1);
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
      expect(catResult!.isMatch).toBe(true);
      expect(catResult!.matchCount).toBeGreaterThanOrEqual(1);

      const dogResult = result.results.find((r) => r.word === '犬');
      expect(dogResult!.isMatch).toBe(true);
      expect(dogResult!.matchCount).toBeGreaterThanOrEqual(1);

      const noMatch = result.results.find((r) => r.word === 'xyz不存在');
      expect(noMatch!.isMatch).toBe(false);
      expect(noMatch!.matchCount).toBe(0);
    });
  });

  describe('surroundingSegments()', () => {
    it('returns sorted context around a position', async () => {
      const { media } = await seedSegmentsIntoEs({}, [
        { contentJa: '前のセグメント', position: 1 },
        { contentJa: '中央セグメント', position: 2 },
        { contentJa: '後のセグメント', position: 3 },
      ]);

      const result = await SegmentDocument.surroundingSegments({
        mediaId: media.id,
        episodeNumber: 1,
        segmentPosition: 2,
      });

      expect(result.segments.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < result.segments.length; i++) {
        expect(result.segments[i].position).toBeGreaterThanOrEqual(result.segments[i - 1].position);
      }
      expect(result.includes.media).toBeDefined();
    });
  });

  describe('findByUuids()', () => {
    it('finds segments by UUID', async () => {
      const { segments } = await seedSegmentsIntoEs({}, [{ contentJa: 'UUID検索' }]);

      const result = await SegmentDocument.findByUuids([segments[0].uuid]);

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].uuid).toBe(segments[0].uuid);
      expect(result.includes.media).toBeDefined();
    });

    it('returns empty for empty UUID array without calling ES', async () => {
      const result = await SegmentDocument.findByUuids([]);

      expect(result.segments).toHaveLength(0);
      expect(result.includes.media).toEqual({});
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
      searchSpy
        .mockRejectedValueOnce(parseError)
        .mockResolvedValueOnce({
          took: 5,
          timed_out: false,
          _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
          hits: { total: { value: 0, relation: 'eq' }, max_score: null, hits: [] },
        } as any);

      const result = await SegmentDocument.search({
        query: { search: 'bad(query' },
        take: 25,
      });

      expect(result.segments).toHaveLength(0);
      expect(searchSpy).toHaveBeenCalledTimes(2);

      searchSpy.mockRestore();
      getMediaInfoMapSpy.mockRestore();
    });

    it('throws InvalidRequestError on cursor length mismatch', async () => {
      const badCursor = encodeKeysetCursor([1.0]);

      await expect(
        SegmentDocument.search({
          query: { search: 'test' },
          take: 25,
          cursor: badCursor,
        }),
      ).rejects.toThrow(InvalidRequestError);
    });

    it('throws InvalidRequestError when segmentLengthChars.min > max', async () => {
      await expect(
        SegmentDocument.search({
          query: { search: 'test' },
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

  describe('delegate methods', () => {
    it('delegates index() to SegmentIndexer', async () => {
      const spy = vi.spyOn(SegmentIndexer, 'index').mockResolvedValue(true);
      const segment = { id: 1 } as any;

      const result = await SegmentDocument.index(segment);

      expect(result).toBe(true);
      expect(spy).toHaveBeenCalledWith(segment);
      spy.mockRestore();
    });

    it('delegates delete() to SegmentIndexer', async () => {
      const spy = vi.spyOn(SegmentIndexer, 'delete').mockResolvedValue(true);

      const result = await SegmentDocument.delete(42);

      expect(result).toBe(true);
      expect(spy).toHaveBeenCalledWith(42);
      spy.mockRestore();
    });

    it('delegates reindex() to SegmentIndexer', async () => {
      const reindexResult = { success: true, message: 'done', stats: { totalSegments: 0, successfulIndexes: 0, failedIndexes: 0, mediaProcessed: 0 }, errors: [] };
      const spy = vi.spyOn(SegmentIndexer, 'reindex').mockResolvedValue(reindexResult);

      const result = await SegmentDocument.reindex();

      expect(result).toEqual(reindexResult);
      expect(spy).toHaveBeenCalledWith(undefined);
      spy.mockRestore();
    });
  });
});
