import type { estypes } from '@elastic/elasticsearch';
import { client, INDEX_NAME } from '@config/elasticsearch';
import { logger } from '@config/log';
import { ALL_CATEGORIES, Media, Segment } from '@app/models';
import { InvalidRequestError } from '@app/errors';
import { Cache, createCacheNamespace } from '@lib/cache';
import { decodeKeysetCursor } from '@lib/cursor';
import { excludedSearchLanguages } from '@lib/searchLanguages';
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
import type { ReindexResponse } from './segmentDocument/SegmentIndexer';

import { SegmentQuery, type QueryParserMode } from './segmentDocument/SegmentQuery';
import { SegmentResponse } from './segmentDocument/SegmentResponse';
import { SegmentIndexer } from './segmentDocument/SegmentIndexer';
import { isSuccessfulMsearchItem, withSafeQueryFallback } from './segmentDocument/errors';

export interface QuerySurroundingSegmentsRequest {
  readonly mediaId: number;
  readonly episodeNumber: number;
  readonly segmentPosition: number;
  readonly limit?: number;
  readonly contentRating?: string[];
}

/** One morphological token, as stored and as served.
 *
 * The ten short names are the published contract: they are in our OpenAPI, in
 * the npm and PyPI SDKs, and in third-party Anki note types, so they do not
 * change. What changed is who fills them. Shirabe parses the corpus now, and
 * groups more coarsely than the old SudachiPy pipeline did: 食べました arrives as
 * ONE token reading タベマシタ where it used to arrive as three. That is the
 * point (it is a word a reader looks up, and it makes furigana come out right),
 * but it means `parts` is what you reach for when you need the finer pieces.
 */
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
  /** word | compound | inflected | counter | function | expression | symbol. */
  kind?: string;
  /** Where this word reads about: GET /v1/words/{wid} on Shirabe. Absent for
   *  names, numbers, punctuation and anything the dictionary has no entry for,
   *  which means "show it, do not link it". */
  wid?: string;
  /** The finer morphemes inside a grouped token, each positioned like its
   *  parent. Elasticsearch highlights against its OWN analyzer, so a match can
   *  land inside one of our tokens: these are the boundaries that let a partial
   *  highlight render. Absent when the token is already atomic. */
  parts?: TokenPart[];
}

export interface TokenPart {
  s: string;
  b: number;
  e: number;
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
  externalVideoId?: string | null;
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

/**
 * Caller-supplied id lists (collection contents) are unbounded, while a single search is
 * capped by `index.max_result_window` (10k by default) and `index.max_terms_count`.
 */
const FIND_BY_IDS_CHUNK_SIZE = 1000;

export class SegmentDocument {
  static readonly SEARCH_STATS_CACHE = createCacheNamespace('searchStats');

  static async search(
    request: SearchRequestInput,
    parserMode: QueryParserMode = 'strict',
  ): Promise<SearchResponseOutput> {
    return SegmentDocument.executeSearch(request, parserMode);
  }

  static async searchInIds(
    segmentIds: number[],
    request: SearchRequestInput,
    parserMode: QueryParserMode = 'strict',
  ): Promise<SearchResponseOutput> {
    if (segmentIds.length === 0) {
      return {
        segments: [],
        includes: { media: {} },
        pagination: {
          hasMore: false,
          estimatedTotalHits: 0,
          estimatedTotalHitsRelation: 'EXACT',
          cursor: null,
        },
      };
    }

    return SegmentDocument.executeSearch(request, parserMode, [{ ids: { values: segmentIds.map(String) } }]);
  }

  private static async executeSearch(
    request: SearchRequestInput,
    parserMode: QueryParserMode,
    extraFilters: estypes.QueryDslQueryContainer[] = [],
  ): Promise<SearchResponseOutput> {
    const filters: SearchFiltersOutput = request.filters ?? {
      status: ['ACTIVE'],
      category: ALL_CATEGORIES,
    };
    const sl = filters.segmentLengthChars;
    if (sl?.min !== undefined && sl?.max !== undefined && sl.min > sl.max) {
      throw new InvalidRequestError('segmentLengthChars.min cannot be greater than segmentLengthChars.max');
    }

    const excludedLanguages = excludedSearchLanguages(filters.languages);
    const { must, isMatchAll, hasQuery } = SegmentQuery.buildSearchMust(
      { query: request.query, filters },
      parserMode,
      excludedLanguages,
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

    const highlightFields: Record<string, estypes.SearchHighlightField> = {
      textJa: {
        matched_fields: ['textJa', 'textJa.kana', 'textJa.baseform', 'textJa.normalized'],
        type: 'fvh',
      },
    };
    if (!excludedLanguages.includes('EN')) {
      highlightFields.textEn = { matched_fields: ['textEn', 'textEn.exact'], type: 'fvh' };
    }
    if (!excludedLanguages.includes('ES')) {
      highlightFields.textEs = { matched_fields: ['textEs', 'textEs.exact'], type: 'fvh' };
    }

    const esResponse = client.search({
      size: request.take,
      sort,
      index: INDEX_NAME,
      highlight: { fields: highlightFields },
      query: { bool: { filter: [...filter, ...extraFilters], must, must_not } },
      search_after: searchAfter,
    });

    const mediaInfo = Media.getMediaInfoMap();

    return withSafeQueryFallback(
      async () => {
        const [esResult, mediaResult] = await Promise.all([esResponse, mediaInfo]);
        return SegmentResponse.buildSearch(esResult, mediaResult);
      },
      () => SegmentDocument.executeSearch(request, 'safe', extraFilters),
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
    const filters: SearchFiltersOutput = request.filters ?? {
      status: ['ACTIVE'],
      category: ALL_CATEGORIES,
    };
    const sl = filters.segmentLengthChars;
    if (sl?.min !== undefined && sl?.max !== undefined && sl.min > sl.max) {
      throw new InvalidRequestError('segmentLengthChars.min cannot be greater than segmentLengthChars.max');
    }

    const { must, hasQuery } = SegmentQuery.buildSearchMust(
      { query: request.query, filters },
      parserMode,
      excludedSearchLanguages(filters.languages),
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

    const hasHiddenMediaExclusion = must_not.length > 0;

    const searches: estypes.MsearchRequestItem[] = words.flatMap((word) => {
      const baseQuery = SegmentQuery.buildMultiLanguage(
        word,
        exactMatch,
        parserMode,
        excludedSearchLanguages(filters?.languages),
      );
      const filteredBody: estypes.MsearchRequestItem = {
        size: 0,
        track_total_hits: true,
        query: { bool: { must: [baseQuery], filter, must_not } },
        aggs: { group_by_media_id: { terms: { field: 'mediaId' } } },
      };
      if (!hasHiddenMediaExclusion) {
        return [{}, filteredBody];
      }
      const unfilteredBody: estypes.MsearchRequestItem = {
        size: 0,
        track_total_hits: true,
        query: { bool: { must: [baseQuery], filter } },
      };
      return [{}, filteredBody, {}, unfilteredBody];
    });

    return withSafeQueryFallback(
      async () => {
        const esResponse = await client.msearch({ index: INDEX_NAME, searches });
        const mediaMapData = await Media.getMediaInfoMap();
        return SegmentResponse.buildWordsMatched(words, esResponse, mediaMapData, hasHiddenMediaExclusion);
      },
      () => SegmentDocument.wordsMatched(words, exactMatch, filters, 'safe'),
      {
        parserMode,
        warnContext: { wordsCount: words.length },
        warnMessage: 'Invalid query syntax in word match; retrying with safe query parser',
      },
    );
  }

  static async wordsCoverageCount(
    words: string[],
    filters?: SearchFiltersOutput,
    parserMode: QueryParserMode = 'strict',
  ): Promise<Map<string, number>> {
    const { filter, must_not } = filters
      ? SegmentQuery.buildCommonFilters(filters)
      : { filter: [] as estypes.QueryDslQueryContainer[], must_not: [] as estypes.QueryDslQueryContainer[] };

    const searches: estypes.MsearchRequestItem[] = words.flatMap((word) => {
      const baseQuery = SegmentQuery.buildMultiLanguage(
        word,
        false,
        parserMode,
        excludedSearchLanguages(filters?.languages),
      );
      return [
        {},
        {
          size: 0,
          track_total_hits: true,
          query: { bool: { must: [baseQuery], filter, must_not } },
        },
      ];
    });

    return withSafeQueryFallback(
      async () => {
        const esResponse = await client.msearch({ index: INDEX_NAME, searches });
        const result = new Map<string, number>();
        for (const [i, word] of words.entries()) {
          const response = esResponse.responses[i] as estypes.SearchResponseBody;
          const total = response.hits?.total as estypes.SearchTotalHits | undefined;
          result.set(word, total?.value ?? 0);
        }
        return result;
      },
      () => SegmentDocument.wordsCoverageCount(words, filters, 'safe'),
      {
        parserMode,
        warnContext: { wordsCount: words.length },
        warnMessage: 'Invalid query syntax in coverage count; retrying with safe query parser',
      },
    );
  }

  static async surroundingSegments(request: QuerySurroundingSegmentsRequest): Promise<SegmentContextResponseOutput> {
    // Sub-search 0 walks forward from the requested position (inclusive), sub-search 1 walks backward.
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
    let forwardSegments: SegmentOutput[] = [];
    let previousSegments: SegmentOutput[] = [];

    const forwardResponse = esResponse.responses[0];
    if (isSuccessfulMsearchItem(forwardResponse)) {
      const result = SegmentResponse.buildSearchResultSegments(forwardResponse, mediaMapData);
      forwardSegments = result.segments;
      Object.assign(mergedMediaMap, result.mediaMap);
    } else {
      logger.warn({ request, response: forwardResponse }, 'Forward context sub-search failed');
    }

    const previousResponse = esResponse.responses[1];
    if (isSuccessfulMsearchItem(previousResponse)) {
      const result = SegmentResponse.buildSearchResultSegments(previousResponse, mediaMapData);
      previousSegments = result.segments;
      Object.assign(mergedMediaMap, result.mediaMap);
    } else {
      logger.warn({ request, response: previousResponse }, 'Previous context sub-search failed');
    }

    const sortedSegments = [...previousSegments, ...forwardSegments].sort((a, b) => a.position - b.position);

    return { segments: sortedSegments, includes: { media: mergedMediaMap } };
  }

  static async findByIds(
    ids: number[],
  ): Promise<{ segments: SegmentOutput[]; includes: { media: Record<string, MediaOutput> } }> {
    if (ids.length === 0) return { segments: [], includes: { media: {} } };

    const mediaInfo = await Media.getMediaInfoMap();
    const segments: SegmentOutput[] = [];
    const media: Record<string, MediaOutput> = {};

    for (let offset = 0; offset < ids.length; offset += FIND_BY_IDS_CHUNK_SIZE) {
      const chunk = ids.slice(offset, offset + FIND_BY_IDS_CHUNK_SIZE);
      const esResponse = await client.search({
        index: INDEX_NAME,
        size: chunk.length,
        query: { terms: { _id: chunk.map(String) } },
      });

      const result = SegmentResponse.buildSearchResultSegments(esResponse, mediaInfo);
      segments.push(...result.segments);
      Object.assign(media, result.mediaMap);
    }

    return { segments, includes: { media } };
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

  static reindex(media?: ReindexMediaItem[], targetIndex?: string): Promise<ReindexResponse> {
    return SegmentIndexer.reindex(media, targetIndex);
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

  const { filter: filterForMediaStatistics, must_not } = SegmentQuery.buildCommonFilters(request.filters);
  const { filter: filterForCategoryStats } = SegmentQuery.buildCommonFilters({
    ...request.filters,
    category: [],
  });

  // `must_not` is only ever populated by `filters.media.exclude` (see SegmentQuery.buildCommonFilters).
  // When present, append an extra category-stats sub-search with the exclusion lifted so the
  // response can carry both `count` (filtered) and `realCount` (without hidden-media exclusion).
  // We deliberately don't add an unfiltered per-media sub-search: a media that survives the
  // exclusion has identical counts with or without `must_not`, so `realMatchCount` would equal
  // `matchCount` for every visible media.
  const hasHiddenMediaExclusion = must_not.length > 0;

  const searches: estypes.MsearchRequestItem[] = [
    {},
    {
      size: 0,
      query: { bool: { filter: filterForMediaStatistics, must: [...mustQueries], must_not } },
      aggs: {
        group_by_media_id: {
          terms: { field: 'mediaId', size: 10000 },
          aggs: { group_by_episode: { terms: { field: 'episode', size: 10000 } } },
        },
      },
    },
    {},
    {
      size: 0,
      query: { bool: { filter: filterForCategoryStats, must: [...mustQueries], must_not } },
      aggs: { group_by_category: { terms: { field: 'category', size: 10 } } },
    },
  ];

  if (hasHiddenMediaExclusion) {
    searches.push(
      {},
      {
        size: 0,
        query: { bool: { filter: filterForCategoryStats, must: [...mustQueries] } },
        aggs: { group_by_category: { terms: { field: 'category', size: 10 } } },
      },
    );
  }

  const [esResponse, mediaInfoResponse] = await Promise.all([
    client.msearch({ index: INDEX_NAME, searches }),
    mediaInfoPromise,
  ]);

  const esMediaStatsResult = esResponse.responses[0] as estypes.SearchResponseBody;
  const esCategoryResult = esResponse.responses[1] as estypes.SearchResponseBody;
  const esCategoryStatsRealResult = hasHiddenMediaExclusion
    ? (esResponse.responses[2] as estypes.SearchResponseBody)
    : null;

  const { stats, mediaMap } = SegmentResponse.buildStatistics(esMediaStatsResult, mediaInfoResponse);

  const result = {
    media: stats,
    categories: SegmentResponse.buildCategoryStatistics(esCategoryResult, esCategoryStatsRealResult),
    includes: { media: mediaMap },
  };
  Cache.set(SegmentDocument.SEARCH_STATS_CACHE, cacheKey, result, 24 * 60 * 60 * 1000);

  return result;
}
