import type { estypes } from '@elastic/elasticsearch';
import { client, INDEX_NAME } from '@config/elasticsearch';
import { Media, Segment, SegmentStatus } from '@app/models';
import { InvalidRequestError } from '@app/errors';
import { logger } from '@config/log';
import { Cache, createCacheNamespace } from '@lib/cache';
import { decodeKeysetCursor } from '@lib/cursor';
import { excludedSearchLanguages } from '@lib/searchLanguages';
import type {
  SearchResponseOutput,
  SearchMultipleResponseOutput,
  SearchStatsResponseOutput,
} from 'generated/outputTypes';

import { getUnhandledReports } from '@app/services/reports/reportedContent';
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

/** Split large id lists into clauses within Elasticsearch limits but keep one search, preserving global ordering and
 * pagination. */
const SEARCH_IN_IDS_CHUNK_SIZE = 1000;
// A normal opening-line page converges in one pass. Keep adversarial/broad pages
// from turning duplicate discovery into an unbounded series of DB + ES calls.
const MAX_DUPLICATE_SEARCH_PASSES = 5;
const MIN_REPEATED_EPISODES = 3;

type SearchCandidate = Pick<SegmentDocumentShape, 'mediaId' | 'textJa' | 'episode'>;

/** Resolve recurring exact subtitles globally in Postgres with a three-episode threshold, so duplicate filtering
 * does not depend on ES page order. */
async function findLaterDuplicateSegmentIds(candidates: SearchCandidate[]): Promise<number[]> {
  const pairs = new Map<string, { mediaId: number; textJa: string }>();
  for (const candidate of candidates) {
    if (!candidate.textJa) continue;
    pairs.set(`${candidate.mediaId}\u0000${candidate.textJa}`, {
      mediaId: candidate.mediaId,
      textJa: candidate.textJa,
    });
  }
  if (pairs.size === 0) return [];

  const rows = await Segment.find({
    select: { id: true, mediaId: true, contentJa: true, episode: true },
    where: [...pairs.values()].map((pair) => ({
      mediaId: pair.mediaId,
      contentJa: pair.textJa,
      status: SegmentStatus.ACTIVE,
    })),
    order: { episode: 'ASC' },
  });

  const episodesByKey = new Map<string, Set<number>>();
  const firstEpisode = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.mediaId}\u0000${row.contentJa}`;
    const episodes = episodesByKey.get(key) ?? new Set<number>();
    episodes.add(row.episode);
    episodesByKey.set(key, episodes);
    const first = firstEpisode.get(key);
    if (first === undefined || row.episode < first) firstEpisode.set(key, row.episode);
  }

  return rows
    .filter((row) => {
      const episodes = episodesByKey.get(`${row.mediaId}\u0000${row.contentJa}`);
      if (!episodes || episodes.size < MIN_REPEATED_EPISODES) return false;
      return row.episode > (firstEpisode.get(`${row.mediaId}\u0000${row.contentJa}`) ?? row.episode);
    })
    .map((row) => row.id);
}

export class SegmentDocument {
  /** Cap this unbounded, large stats cache to bound heap use; the frontend should avoid making crawler requests for
   * a panel they cannot render. */
  static readonly SEARCH_STATS_CACHE = createCacheNamespace('searchStats', 250);

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

    // Load reports before building the search because they change the query; the result is cached, so normal requests
    // pay only a lookup.
    const reports = await getUnhandledReports();

    // Keep report exclusions separate from hidden-media `must_not`; other code uses that array length to detect
    // hidden-media filtering.
    const excludedByReport = reports.segmentIds.size > 0 ? [buildIdsFilter([...reports.segmentIds])] : [];

    const dedupeOpeningLines =
      filters.status?.length === 1 &&
      filters.status[0] === SegmentStatus.ACTIVE &&
      !filters.media?.include?.some((item) => item.episodes && item.episodes.length > 0);
    const baseQuery = SegmentQuery.applyMediaScoreWeights(
      { bool: { filter: [...filter, ...extraFilters], must, must_not: [...must_not, ...excludedByReport] } },
      { demoted: reports.mediaWeights, preferred: preferredMediaIds },
    );

    const mediaInfo = Media.getMediaInfoMap();

    return withSafeQueryFallback(
      async () => {
        const searchPage = (excludedDuplicateIds: number[] = []) =>
          client.search({
            size: request.take,
            sort,
            index: INDEX_NAME,
            highlight: { fields: highlightFields },
            query:
              excludedDuplicateIds.length === 0
                ? baseQuery
                : {
                    bool: {
                      must: [baseQuery],
                      must_not: [buildIdsFilter(excludedDuplicateIds)],
                    },
                  },
            search_after: searchAfter,
          });
        const [initialResponse, mediaResult] = await Promise.all([searchPage(), mediaInfo]);
        let finalResponse = initialResponse;
        if (dedupeOpeningLines) {
          const excludedDuplicateIds = new Set<number>();
          for (let pass = 0; pass < MAX_DUPLICATE_SEARCH_PASSES; pass += 1) {
            const hits = finalResponse.hits.hits as estypes.SearchHit<SegmentDocumentShape>[];
            let duplicateIds: number[];
            try {
              duplicateIds = await findLaterDuplicateSegmentIds(
                hits.flatMap((hit) => (hit._source ? [hit._source] : [])),
              );
            } catch (error) {
              // Filtering is an enhancement; an unavailable database must not
              // turn an otherwise healthy Elasticsearch search into a failure.
              logger.warn({ error }, 'Skipping duplicate subtitle filtering after database lookup failure');
              break;
            }
            const newDuplicateIds = duplicateIds.filter((id) => !excludedDuplicateIds.has(id));
            if (newDuplicateIds.length === 0) break;
            for (const id of newDuplicateIds) excludedDuplicateIds.add(id);
            finalResponse = await searchPage([...excludedDuplicateIds]);
          }
        }
        return SegmentResponse.buildSearch(finalResponse as estypes.SearchResponse, mediaResult);
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
    // Category counts power the All escape hatch: retain hidden-media exclusions but lift the selected title/category,
    // even when it has no matches.
    category: [],
    media: request.filters.media?.exclude ? { exclude: request.filters.media.exclude } : undefined,
  });

  // When hidden media is excluded, add one category-only sub-search for `realCount`; a visible media needs no redundant
  // unfiltered sub-search.
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
