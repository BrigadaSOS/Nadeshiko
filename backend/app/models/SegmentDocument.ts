import type { estypes } from '@elastic/elasticsearch';
import { client, INDEX_NAME } from '@config/elasticsearch';
import { Media, Segment } from '@app/models';
import { InvalidRequestError } from '@app/errors';
import { Cache, createCacheNamespace } from '@lib/cache';
import { decodeKeysetCursor } from '@lib/cursor';
import type {
  SearchResponseOutput,
  SearchMultipleResponseOutput,
  SegmentContextResponseOutput,
  SegmentOutput,
  MediaOutput,
  SearchRequestOutput,
  SearchStatsRequestOutput,
  SearchFiltersOutput,
  SearchStatsResponseOutput,
} from 'generated/outputTypes';
import type { t_ReindexResponse } from 'generated/models';

import { SegmentQuery, type QueryParserMode } from './segmentDocument/SegmentQuery';
import { SegmentResponse, type SearchResponseOptions } from './segmentDocument/SegmentResponse';
import { SegmentIndexer } from './segmentDocument/SegmentIndexer';
import { withSafeQueryFallback } from './segmentDocument/errors';

export interface QuerySurroundingSegmentsRequest {
  readonly mediaId: number;
  readonly episodeNumber: number;
  readonly segmentPosition: number;
  readonly limit?: number;
  readonly contentRating?: string[];
}

export interface SlimToken {
  s: string;
  d: string;
  r: string;
  b: number;
  e: number;
  p: string;
  p1?: string;
  p2?: string;
  p4?: string;
  cf?: string;
}

export interface SegmentDocumentShape {
  uuid: string;
  publicId: string;
  position: number;
  status: string;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  textJa: string;
  characterCount: number;
  textEs: string;
  textEsMt: boolean;
  textEn: string;
  textEnMt: boolean;
  contentRating: string;
  storage: string;
  hashedId: string;
  category: string;
  episode: number;
  mediaId: number;
  storageBasePath: string;
  tokens?: SlimToken[];
}

export interface ReindexMediaItem {
  mediaId: number;
  episodes?: number[];
}

type SearchStatisticsOutput = Pick<SearchStatsResponseOutput, 'media' | 'categories' | 'includes'>;
type SearchRequestInput = Omit<SearchRequestOutput, 'include'> & { include?: SearchRequestOutput['include'] };
type SearchStatsRequestInput = Omit<SearchStatsRequestOutput, 'include'> & {
  include?: SearchStatsRequestOutput['include'];
};

export class SegmentDocument {
  static readonly SEARCH_STATS_CACHE = createCacheNamespace('searchStats');

  static async search(
    request: SearchRequestInput,
    parserMode: QueryParserMode = 'strict',
    options?: SearchResponseOptions,
  ): Promise<SearchResponseOutput> {
    const filters: SearchFiltersOutput = request.filters ?? { status: ['ACTIVE'], category: ['ANIME', 'JDRAMA'] };
    const sl = filters.segmentLengthChars;
    if (sl?.min !== undefined && sl?.max !== undefined && sl.min > sl.max) {
      throw new InvalidRequestError('segmentLengthChars.min cannot be greater than segmentLengthChars.max');
    }

    const { must, isMatchAll, hasQuery } = SegmentQuery.buildSearchMust(
      { query: request.query, filters },
      parserMode,
      filters.languages?.exclude,
    );

    const { filter, must_not } = SegmentQuery.buildCommonFilters(filters);
    const { sort, randomScoreQuery } = SegmentQuery.buildSortAndRandomScore(request, filters, isMatchAll);
    const searchAfter = decodeKeysetCursor<estypes.FieldValue[]>(request.cursor);

    if (searchAfter && searchAfter.length > 0) {
      const sortArray = Array.isArray(sort) ? sort : [sort];
      if (searchAfter.length !== sortArray.length) {
        throw new InvalidRequestError(
          `Cursor length mismatch: expected ${sortArray.length} values but got ${searchAfter.length}. ` +
            `The cursor must match the current sort configuration.`,
        );
      }
    }

    if (randomScoreQuery && (isMatchAll || hasQuery)) {
      const lastQuery = must.pop();
      if (lastQuery) {
        (randomScoreQuery.function_score as any).query = lastQuery;
        must.push(randomScoreQuery);
      }
    }

    const excludeLangs = new Set(filters.languages?.exclude ?? []);
    const highlightFields: Record<string, estypes.SearchHighlightField> = {
      textJa: {
        matched_fields: ['textJa', 'textJa.kana', 'textJa.baseform', 'textJa.normalized'],
        type: 'fvh',
      },
    };
    if (!excludeLangs.has('en')) {
      highlightFields.textEn = { matched_fields: ['textEn', 'textEn.exact'], type: 'fvh' };
    }
    if (!excludeLangs.has('es')) {
      highlightFields.textEs = { matched_fields: ['textEs', 'textEs.exact'], type: 'fvh' };
    }

    const esResponse = client.search({
      size: request.take,
      sort,
      index: INDEX_NAME,
      highlight: { fields: highlightFields },
      query: { bool: { filter, must, must_not } },
      search_after: searchAfter,
    });

    const mediaInfo = Media.getMediaInfoMap();

    return withSafeQueryFallback(
      async () => {
        const [esResult, mediaResult] = await Promise.all([esResponse, mediaInfo]);
        return SegmentResponse.buildSearch(esResult, mediaResult, options);
      },
      () => SegmentDocument.search(request, 'safe', options),
      {
        parserMode,
        hasQuery,
        warnContext: { search: request.query?.search },
        warnMessage: 'Invalid query syntax; retrying search with safe query parser',
      },
    );
  }

  static async searchStats(
    request: SearchStatsRequestInput,
    parserMode: QueryParserMode = 'strict',
  ): Promise<SearchStatsResponseOutput> {
    const filters: SearchFiltersOutput = request.filters ?? { status: ['ACTIVE'], category: ['ANIME', 'JDRAMA'] };
    const sl = filters.segmentLengthChars;
    if (sl?.min !== undefined && sl?.max !== undefined && sl.min > sl.max) {
      throw new InvalidRequestError('segmentLengthChars.min cannot be greater than segmentLengthChars.max');
    }

    const { must, hasQuery } = SegmentQuery.buildSearchMust(
      { query: request.query, filters },
      parserMode,
      filters.languages?.exclude,
    );
    const mediaInfo = Media.getMediaInfoMap();

    return withSafeQueryFallback(
      () => querySearchStatisticsWithMustQueries({ ...request, filters }, must, mediaInfo, parserMode),
      () => SegmentDocument.searchStats(request, 'safe'),
      {
        parserMode,
        hasQuery,
        warnContext: { search: request.query?.search },
        warnMessage: 'Invalid query syntax; retrying search stats with safe query parser',
      },
    );
  }

  static async wordsMatched(
    words: string[],
    exactMatch: boolean,
    filters?: SearchFiltersOutput,
    parserMode: QueryParserMode = 'strict',
  ): Promise<SearchMultipleResponseOutput> {
    const { filter, must_not } = filters
      ? SegmentQuery.buildCommonFilters(filters)
      : { filter: [] as estypes.QueryDslQueryContainer[], must_not: [] as estypes.QueryDslQueryContainer[] };

    const searches: estypes.MsearchRequestItem[] = words.flatMap((word) => {
      const baseQuery = SegmentQuery.buildMultiLanguage(word, exactMatch, parserMode, filters?.languages?.exclude);
      return [
        {},
        {
          size: 0,
          query: { bool: { must: [baseQuery], filter, must_not } },
          aggs: { group_by_media_id: { terms: { field: 'mediaId' } } },
        },
      ];
    });

    return withSafeQueryFallback(
      async () => {
        const esResponse = await client.msearch({ index: INDEX_NAME, searches });
        const mediaMapData = await Media.getMediaInfoMap();
        return SegmentResponse.buildWordsMatched(words, esResponse, mediaMapData);
      },
      () => SegmentDocument.wordsMatched(words, exactMatch, filters, 'safe'),
      {
        parserMode,
        warnContext: { wordsCount: words.length },
        warnMessage: 'Invalid query syntax in word match; retrying with safe query parser',
      },
    );
  }

  static async surroundingSegments(request: QuerySurroundingSegmentsRequest): Promise<SegmentContextResponseOutput> {
    const contextSearches: estypes.MsearchRequestItem[] = [
      {},
      {
        sort: [{ position: { order: 'asc' } }],
        size: request.limit ? request.limit + 1 : 16,
        query: SegmentQuery.buildUuidContext(
          request.mediaId,
          request.episodeNumber,
          {
            range: { position: { gte: request.segmentPosition } },
          },
          request.contentRating,
        ),
      },
      {},
      {
        sort: [{ position: { order: 'desc' } }],
        size: request.limit || 14,
        query: SegmentQuery.buildUuidContext(
          request.mediaId,
          request.episodeNumber,
          {
            range: { position: { lt: request.segmentPosition } },
          },
          request.contentRating,
        ),
      },
    ];

    const esResponse = await client.msearch({ index: INDEX_NAME, searches: contextSearches });
    const mediaMapData = await Media.getMediaInfoMap();

    const mergedMediaMap: Record<string, MediaOutput> = {};
    let previousSegments: SegmentOutput[] = [];
    let nextSegments: SegmentOutput[] = [];

    if (esResponse.responses[0].status) {
      const result = SegmentResponse.buildSearchResultSegments(
        esResponse.responses[0] as estypes.SearchResponseBody,
        mediaMapData,
      );
      previousSegments = result.segments;
      Object.assign(mergedMediaMap, result.mediaMap);
    }

    if (esResponse.responses[1].status) {
      const result = SegmentResponse.buildSearchResultSegments(
        esResponse.responses[1] as estypes.SearchResponseBody,
        mediaMapData,
      );
      nextSegments = result.segments;
      Object.assign(mergedMediaMap, result.mediaMap);
    }

    const sortedSegments = [...previousSegments, ...nextSegments].sort((a, b) => a.position - b.position);

    return { segments: sortedSegments, includes: { media: mergedMediaMap } };
  }

  static async findByIds(
    ids: number[],
    options?: SearchResponseOptions,
  ): Promise<{ segments: SegmentOutput[]; includes: { media: Record<string, MediaOutput> } }> {
    if (ids.length === 0) return { segments: [], includes: { media: {} } };

    const esResponse = await client.search({
      index: INDEX_NAME,
      size: ids.length,
      query: { terms: { _id: ids.map(String) } },
    });

    const mediaInfo = await Media.getMediaInfoMap();
    const { segments, mediaMap } = SegmentResponse.buildSearchResultSegments(esResponse, mediaInfo, options);
    return { segments, includes: { media: mediaMap } };
  }

  static index(segment: Segment): Promise<boolean> {
    return SegmentIndexer.index(segment);
  }

  static bulkIndex(segments: Segment[]) {
    return SegmentIndexer.bulkIndex(segments);
  }

  static delete(id: number): Promise<boolean> {
    return SegmentIndexer.delete(id);
  }

  static bulkDelete(ids: number[]) {
    return SegmentIndexer.bulkDelete(ids);
  }

  static reindex(media?: ReindexMediaItem[]): Promise<t_ReindexResponse> {
    return SegmentIndexer.reindex(media);
  }
}

async function querySearchStatisticsWithMustQueries(
  request: { query?: SearchStatsRequestInput['query']; filters: SearchFiltersOutput },
  mustQueries: estypes.QueryDslQueryContainer[],
  mediaInfoPromise: Promise<Awaited<ReturnType<typeof Media.getMediaInfoMap>>>,
  parserMode: QueryParserMode,
): Promise<SearchStatisticsOutput> {
  const cacheKey = SegmentQuery.buildSearchStatsCacheKey(request, parserMode);
  const cached = Cache.get<SearchStatisticsOutput>(SegmentDocument.SEARCH_STATS_CACHE, cacheKey);
  if (cached) {
    return cached;
  }

  const { filter: filterForMediaStatistics, must_not: must_notForMediaStatistics } = SegmentQuery.buildCommonFilters(
    request.filters,
  );

  const esMediaStatsResponse = client.search({
    size: 0,
    index: INDEX_NAME,
    query: {
      bool: { filter: filterForMediaStatistics, must: [...mustQueries], must_not: must_notForMediaStatistics },
    },
    aggs: {
      group_by_media_id: {
        terms: { field: 'mediaId', size: 10000 },
        aggs: { group_by_episode: { terms: { field: 'episode', size: 10000 } } },
      },
    },
  });

  const { filter: filterForCategoryStats, must_not: must_notForCategoryStats } = SegmentQuery.buildCommonFilters({
    ...request.filters,
    category: [],
  });

  const esCategoryStatsResponse = client.search({
    size: 0,
    index: INDEX_NAME,
    query: { bool: { filter: filterForCategoryStats, must: [...mustQueries], must_not: must_notForCategoryStats } },
    aggs: { group_by_category: { terms: { field: 'category', size: 10 } } },
  });

  const [esMediaStatsResult, esCategoryResult, mediaInfoResponse] = await Promise.all([
    esMediaStatsResponse,
    esCategoryStatsResponse,
    mediaInfoPromise,
  ]);

  const { stats, mediaMap } = SegmentResponse.buildStatistics(esMediaStatsResult, mediaInfoResponse);

  const result = {
    media: stats,
    categories: SegmentResponse.buildCategoryStatistics(esCategoryResult),
    includes: { media: mediaMap },
  };
  Cache.set(SegmentDocument.SEARCH_STATS_CACHE, cacheKey, result, 24 * 60 * 60 * 1000);

  return result;
}
