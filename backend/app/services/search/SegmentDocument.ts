import type { estypes } from '@elastic/elasticsearch';
import { client, INDEX_NAME } from '@config/elasticsearch';
import { Media } from '@app/models';
import { InvalidRequestError } from '@app/errors';
import { Cache, createCacheNamespace } from '@lib/cache';
import { decodeKeysetCursor } from '@lib/cursor';
import { excludedSearchLanguages } from '@lib/searchLanguages';
import type {
  SearchResponseOutput,
  SearchMultipleResponseOutput,
  SearchStatsResponseOutput,
} from 'generated/outputTypes';

import { SegmentQuery, type QueryParserMode } from './segmentDocument/SegmentQuery';
import { SegmentResponse } from './segmentDocument/SegmentResponse';
import { withSafeQueryFallback } from './segmentDocument/errors';
import {
  resolveSearchFilters,
  type ResolvedFilters,
  type SearchRequestInput,
  type SearchStatsRequestInput,
} from './segmentDocument/searchInputs';
import type { SlimToken } from '@app/models/Segment';

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

/**
 * Caller-supplied id lists (collection contents) are unbounded, while a single search is
 * capped by `index.max_result_window` (10k by default) and `index.max_terms_count`.
 *
 * Chunking into one search per chunk would mean one sort, one `search_after` cursor and
 * one hit total per chunk, none of which merge back into a single paginated response.
 * Splitting the list into `should` clauses instead keeps every clause well under
 * `index.max_terms_count` (65,536 by default) while staying ONE search, so ordering and
 * pagination behave exactly as they do without an id filter.
 */
const SEARCH_IN_IDS_CHUNK_SIZE = 1000;

export class SegmentDocument {
  static readonly SEARCH_STATS_CACHE = createCacheNamespace('searchStats');

  static async search(
    request: SearchRequestInput,
    parserMode: QueryParserMode = 'strict',
    preferredMediaIds?: ReadonlySet<number>,
  ): Promise<SearchResponseOutput> {
    return SegmentDocument.executeSearch(request, parserMode, [], preferredMediaIds);
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

    return SegmentDocument.executeSearch(request, parserMode, [buildIdsFilter(segmentIds)]);
  }

  private static async executeSearch(
    request: SearchRequestInput,
    parserMode: QueryParserMode,
    extraFilters: estypes.QueryDslQueryContainer[] = [],
    preferredMediaIds?: ReadonlySet<number>,
  ): Promise<SearchResponseOutput> {
    const filters = resolveSearchFilters(request.filters);

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
        return SegmentResponse.buildSearch(esResult, mediaResult, preferredMediaIds);
      },
      () => SegmentDocument.executeSearch(request, 'safe', extraFilters, preferredMediaIds),
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
    const filters = resolveSearchFilters(request.filters);

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
    filters?: ResolvedFilters,
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
    filters?: ResolvedFilters,
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
}

function buildIdsFilter(segmentIds: number[]): estypes.QueryDslQueryContainer {
  const values = segmentIds.map(String);
  if (values.length <= SEARCH_IN_IDS_CHUNK_SIZE) {
    return { ids: { values } };
  }

  const should: estypes.QueryDslQueryContainer[] = [];
  for (let offset = 0; offset < values.length; offset += SEARCH_IN_IDS_CHUNK_SIZE) {
    should.push({ ids: { values: values.slice(offset, offset + SEARCH_IN_IDS_CHUNK_SIZE) } });
  }

  // `minimum_should_match` is 1 by default for a bool with no other clause, but this sits
  // inside a `filter` array where the default has moved before; say it outright.
  return { bool: { should, minimum_should_match: 1 } };
}

async function querySearchStatisticsWithMustQueries(
  request: { query?: SearchStatsRequestInput['query']; filters: ResolvedFilters },
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
