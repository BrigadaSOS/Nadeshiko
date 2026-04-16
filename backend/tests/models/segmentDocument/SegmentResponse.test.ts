import { describe, expect, it } from 'bun:test';
import type { estypes } from '@elastic/elasticsearch';
import { SegmentResponse } from '@app/models/segmentDocument/SegmentResponse';
import type { SegmentDocumentShape, SlimToken } from '@app/models/SegmentDocument';

function token(s: string, d: string, b: number, e: number, p: string): SlimToken {
  return { s, d, r: '', b, e, p };
}

function makeMediaInfoMap(mediaId: number) {
  return {
    results: new Map([
      [
        mediaId,
        {
          mediaId,
          publicId: 'media-pub-1',
          category: 'ANIME',
          categoryName: 'ANIME',
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: undefined,
          nameRomaji: 'Test Anime',
          nameEn: 'Test Anime EN',
          nameJa: 'テストアニメ',
          airingFormat: 'TV',
          airingStatus: 'FINISHED',
          genres: ['Action'],
          cover: 'https://example.com/cover.jpg',
          banner: 'https://example.com/banner.jpg',
          startDate: '2025-01-01',
          endDate: '2025-03-01' as string | undefined,
          version: 1,
          segmentCount: 100,
          episodeCount: 12,
          studio: 'Test Studio',
          seasonName: 'WINTER',
          seasonYear: 2025,
          externalIds: { anilist: null, imdb: null, tmdb: null, tvdb: null },
          storageBasePath: 'anime/test-anime',
        },
      ],
    ]),
    stats: { totalAnimes: 1, totalSegments: 100, fullTotalAnimes: 1, fullTotalSegments: 100 },
  };
}

function makeEsHit(
  id: string,
  source: Partial<SegmentDocumentShape>,
  highlight?: Record<string, string[]>,
): estypes.SearchHit<SegmentDocumentShape> {
  return {
    _index: 'segments',
    _id: id,
    _source: {
      uuid: 'uuid-1',
      publicId: 'pub-1',
      position: 1,
      status: 'ACTIVE',
      startTimeMs: 1000,
      endTimeMs: 2000,
      durationMs: 1000,
      textJa: 'テスト',
      characterCount: 3,
      textEn: 'Test',
      textEnMt: false,
      textEs: 'Prueba',
      textEsMt: true,
      contentRating: 'SAFE',
      storage: 'R2',
      hashedId: 'abc123',
      category: 'ANIME',
      episode: 1,
      mediaId: 1,
      storageBasePath: 'anime/test-anime',
      ...source,
    },
    ...(highlight ? { highlight } : {}),
  } as estypes.SearchHit<SegmentDocumentShape>;
}

function makeEsResponse(hits: estypes.SearchHit<SegmentDocumentShape>[]): estypes.SearchResponse {
  return {
    took: 1,
    timed_out: false,
    _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
    hits: {
      total: { value: hits.length, relation: 'eq' },
      max_score: 1,
      hits,
    },
  };
}

describe('SegmentResponse', () => {
  describe('buildSearchResultSegments', () => {
    it('includes tokens in textJa when present in source', () => {
      const tokens = [token('テスト', 'テスト', 0, 3, '名詞')];
      const hit = makeEsHit('1', { tokens });
      const esResponse = makeEsResponse([hit]);
      const mediaInfo = makeMediaInfoMap(1);

      const { segments } = SegmentResponse.buildSearchResultSegments(esResponse, mediaInfo);

      expect(segments).toHaveLength(1);
      expect(segments[0].textJa.tokens).toEqual([{ ...tokens[0], p1: null, p2: null, p4: null, cf: null }]);
    });

    it('omits tokens from textJa when not present in source', () => {
      const hit = makeEsHit('1', {});
      const esResponse = makeEsResponse([hit]);
      const mediaInfo = makeMediaInfoMap(1);

      const { segments } = SegmentResponse.buildSearchResultSegments(esResponse, mediaInfo);

      expect(segments).toHaveLength(1);
      expect(segments[0].textJa.tokens).toBeNull();
    });

    it('uses tokens for enhanced highlighting when both tokens and highlight are present', () => {
      const tokens = [token('食べ', '食べる', 0, 2, '動詞'), token('ました', 'ます', 2, 5, '助動詞')];
      const hit = makeEsHit('1', { textJa: '食べました', tokens }, { textJa: ['<em>食べ</em>ました'] });
      const esResponse = makeEsResponse([hit]);
      const mediaInfo = makeMediaInfoMap(1);

      const { segments } = SegmentResponse.buildSearchResultSegments(esResponse, mediaInfo);

      expect(segments).toHaveLength(1);
      expect(segments[0].textJa.highlight).toBe('<em>食べ</em><span class="highlight-tail">ました</span>');
      expect(segments[0].textJa.tokens).toEqual([
        { ...tokens[0], p1: null, p2: null, p4: null, cf: null },
        { ...tokens[1], p1: null, p2: null, p4: null, cf: null },
      ]);
    });

    it('returns unenhanced highlight when tokens are absent', () => {
      const hit = makeEsHit('1', { textJa: '食べました' }, { textJa: ['<em>食べ</em>ました'] });
      const esResponse = makeEsResponse([hit]);
      const mediaInfo = makeMediaInfoMap(1);

      const { segments } = SegmentResponse.buildSearchResultSegments(esResponse, mediaInfo);

      expect(segments).toHaveLength(1);
      expect(segments[0].textJa.highlight).toBe('<em>食べ</em>ました');
      expect(segments[0].textJa.tokens).toBeNull();
    });
  });
});
