import { createHash } from 'node:crypto';
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
import { isQuerySyntaxError, withSafeQueryFallback } from './segmentDocument/errors';
import {
  buildRounds,
  decodeVarietyCursor,
  encodeRestCursor,
  encodeRoundsCursor,
  indexAfterCursor,
  shouldDiversify,
  VARIETY_CANDIDATES_PER_TITLE,
  VARIETY_MAX_GROUPS,
  type RoundEntry,
  type VarietyBlock,
  type VarietyCursor,
} from './segmentDocument/variety';
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

  /** Round lists per query (see `loadRounds`), so every page of one search reads the same list. Shared by every
   * reader, since stars do not change the list. An entry is at most `2 * VARIETY_MAX_GROUPS` small objects, and most
   * are a few dozen. */
  static readonly VARIETY_ROUNDS_CACHE = createCacheNamespace('searchVarietyRounds', 256);

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
    // Rounds by title for the default order -- see ./segmentDocument/variety. Only on the public search (not
    // `searchInIds`, which pages a collection), and not for a keyset cursor issued before rounds existed, which
    // keeps paging in the order it started in.
    const sortLength = (Array.isArray(sort) ? sort : [sort]).length;
    const varietyCursor =
      extraFilters.length === 0 && shouldDiversify(request, filters, hasQuery)
        ? decodeVarietyCursor(request.cursor, sortLength)
        : 'keyset';
    const searchAfter =
      varietyCursor === 'keyset' ? decodeKeysetCursor<estypes.FieldValue[]>(request.cursor) : undefined;

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
    const coreQuery: estypes.QueryDslQueryContainer = {
      bool: { filter: [...filter, ...extraFilters], must, must_not: [...must_not, ...excludedByReport] },
    };
    // Plain order: reports demote titles and the reader's stars give a small boost.
    const baseQuery = SegmentQuery.applyMediaScoreWeights(coreQuery, {
      demoted: reports.mediaWeights,
      preferred: preferredMediaIds,
    });
    // Rounds: stars decide the block a title falls in, not its score, so the
    // query (and the cached round list) is the same for every reader.
    const sharedQuery = SegmentQuery.applyMediaScoreWeights(coreQuery, { demoted: reports.mediaWeights });

    const mediaInfo = Media.getMediaInfoMap();

    return withSafeQueryFallback(
      async () => {
        /** One keyset page in plain sort order, narrowed by `restrict`, with recurring opening lines filtered out. */
        const keysetPage = async (
          query: estypes.QueryDslQueryContainer,
          size: number,
          after: estypes.FieldValue[] | undefined,
          restrict: KeysetRestriction = {},
        ) => {
          const searchPage = (excludedDuplicateIds: number[] = []) => {
            const exclusions = [...(restrict.excludedIds ?? []), ...excludedDuplicateIds];
            const mustNot = [
              ...(restrict.mustNot ?? []),
              ...(exclusions.length > 0 ? [buildIdsFilter(exclusions)] : []),
            ];
            const narrowing = restrict.filter ?? [];
            return client.search({
              size,
              sort,
              index: INDEX_NAME,
              highlight: { fields: highlightFields },
              query:
                mustNot.length === 0 && narrowing.length === 0
                  ? query
                  : { bool: { must: [query], filter: narrowing, must_not: mustNot } },
              search_after: after,
            });
          };
          let finalResponse = await searchPage();
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
          return finalResponse;
        };

        const plainPage = async () => {
          const [finalResponse, mediaResult] = await Promise.all([
            keysetPage(baseQuery, request.take, searchAfter),
            mediaInfo,
          ]);
          return SegmentResponse.buildSearch(finalResponse as estypes.SearchResponse, mediaResult);
        };

        if (varietyCursor === 'keyset') return plainPage();

        return varietyPage({
          take: request.take,
          cursor: varietyCursor,
          query: sharedQuery,
          favorites: preferredMediaIds ?? new Set(),
          sort,
          highlightFields,
          dedupeOpeningLines,
          keysetPage: (size, after, restrict) => keysetPage(sharedQuery, size, after, restrict),
          plainPage,
          mediaInfo,
        });
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

const VARIETY_ROUNDS_TTL_MS = 10 * 60 * 1000;
/** A list whose duplicate lookup failed is still served, but only kept briefly, so the full one replaces it soon. */
const VARIETY_DEGRADED_TTL_MS = 15 * 1000;

type CachedRounds = { rounds: RoundEntry[]; total: estypes.SearchHitsMetadata['total'] };

/** Narrowing for one keyset page: sentences to leave out, and the block's title filter. */
type KeysetRestriction = {
  excludedIds?: Array<number | string>;
  filter?: estypes.QueryDslQueryContainer[];
  mustNot?: estypes.QueryDslQueryContainer[];
};

/** Concurrent first requests for the same list share one computation instead of each running the collapse. */
const roundsInFlight = new Map<string, Promise<CachedRounds>>();

async function loadRounds(
  query: estypes.QueryDslQueryContainer,
  sort: estypes.Sort,
  dedupeOpeningLines: boolean,
): Promise<CachedRounds> {
  const cacheKey = createHash('sha1').update(JSON.stringify({ query, sort, dedupeOpeningLines })).digest('hex');
  const cached = Cache.get<CachedRounds>(SegmentDocument.VARIETY_ROUNDS_CACHE, cacheKey);
  if (cached) return cached;
  const pending = roundsInFlight.get(cacheKey);
  if (pending) return pending;

  const computation = (async () => {
    const collapsed = await client.search({
      index: INDEX_NAME,
      size: VARIETY_MAX_GROUPS,
      sort,
      query,
      _source: false,
      collapse: {
        field: 'mediaId',
        inner_hits: {
          name: 'rounds',
          size: VARIETY_CANDIDATES_PER_TITLE,
          sort,
          _source: ['mediaId', 'textJa', 'episode'],
        },
      },
    });

    // The same recurring-opening-line rule as the keyset pages, so a show's
    // round slot is never an episode-five copy of its opening.
    let duplicates = new Set<string>();
    let degraded = false;
    if (dedupeOpeningLines) {
      const candidates = collapsed.hits.hits.flatMap((group) =>
        (group.inner_hits?.rounds?.hits?.hits ?? []).flatMap((hit) =>
          hit._source ? [hit._source as Pick<SegmentDocumentShape, 'mediaId' | 'textJa' | 'episode'>] : [],
        ),
      );
      try {
        duplicates = new Set((await findLaterDuplicateSegmentIds(candidates)).map(String));
      } catch (error) {
        degraded = true;
        logger.warn({ error }, 'Skipping duplicate subtitle filtering for search rounds after database lookup failure');
      }
    }

    const result = { rounds: buildRounds(collapsed, sort, duplicates), total: collapsed.hits.total };
    Cache.set(
      SegmentDocument.VARIETY_ROUNDS_CACHE,
      cacheKey,
      result,
      degraded ? VARIETY_DEGRADED_TTL_MS : VARIETY_ROUNDS_TTL_MS,
    );
    return result;
  })();

  roundsInFlight.set(cacheKey, computation);
  try {
    return await computation;
  } finally {
    roundsInFlight.delete(cacheKey);
  }
}

/**
 * One page of a relevance search served in rounds by title (see ./segmentDocument/variety).
 *
 * The page walks a fixed sequence of stages -- the starred block's rounds, the starred block's rest, then the same
 * two for every other title -- picking up where the cursor left off and crossing into the next stage mid-page when
 * one runs out. Rest stages are the ordinary keyset search with every round sentence excluded, so nothing is shown
 * twice.
 */
async function varietyPage(args: {
  take: number;
  cursor: VarietyCursor | undefined;
  query: estypes.QueryDslQueryContainer;
  favorites: ReadonlySet<number>;
  sort: estypes.Sort;
  highlightFields: Record<string, estypes.SearchHighlightField>;
  dedupeOpeningLines: boolean;
  keysetPage: (
    size: number,
    after: estypes.FieldValue[] | undefined,
    restrict?: KeysetRestriction,
  ) => Promise<estypes.SearchResponse<unknown>>;
  /** The plain order, for a first page whose rounds could not be computed. */
  plainPage: () => Promise<SearchResponseOutput>;
  mediaInfo: ReturnType<typeof Media.getMediaInfoMap>;
}): Promise<SearchResponseOutput> {
  const { take, cursor, query, favorites, sort, highlightFields, dedupeOpeningLines, keysetPage, mediaInfo } = args;

  let loaded: CachedRounds;
  try {
    loaded = await loadRounds(query, sort, dedupeOpeningLines);
  } catch (error) {
    // Rounds are an enhancement. If Elasticsearch cannot compute them (a timeout, a breaker), a first page falls back
    // to the plain order -- its keyset cursor keeps the rest of that search plain too. Mid-scroll there is no plain
    // page to fall back to without repeating what was shown, and a query syntax error must reach the safe-parser retry.
    if (cursor || isQuerySyntaxError(error)) throw error;
    logger.warn({ error }, 'Search rounds failed; serving the plain relevance order');
    return args.plainPage();
  }
  const { rounds, total } = loaded;

  const favoriteIds = [...favorites];
  const blocks: VarietyBlock[] = favoriteIds.length > 0 ? ['fav', 'all'] : ['all'];
  const stages = blocks.flatMap((block) => [
    { block, phase: 'rounds' as const },
    { block, phase: 'rest' as const },
  ]);
  const inBlock = (block: VarietyBlock, mediaId: number) =>
    block === 'fav' ? favorites.has(mediaId) : !favorites.has(mediaId);
  const restrictFor = (block: VarietyBlock): KeysetRestriction => {
    if (block === 'fav') return { filter: [{ terms: { mediaId: favoriteIds } }] };
    return favoriteIds.length > 0 ? { mustNot: [{ terms: { mediaId: favoriteIds } }] } : {};
  };
  const roundIds = rounds.map((entry) => entry.id);

  // Resume at the cursor's stage. A starred-block cursor from a reader who has since unstarred everything resumes at
  // the start of the shared block rather than failing.
  let stageIndex = cursor ? stages.findIndex((s) => s.block === cursor.block && s.phase === cursor.phase) : 0;
  let stageCursor: VarietyCursor | undefined = cursor;
  if (stageIndex === -1) {
    stageIndex = stages.findIndex((s) => s.block === 'all' && s.phase === 'rounds');
    stageCursor = undefined;
  }

  type Piece = { entry: RoundEntry } | { hit: estypes.SearchHit<unknown> };
  const pieces: Piece[] = [];
  let remaining = take;
  let nextCursor: string | undefined;

  while (remaining > 0 && stageIndex < stages.length) {
    const stage = stages[stageIndex];
    if (!stage) break;

    if (stage.phase === 'rounds') {
      const entries = rounds.filter((entry) => inBlock(stage.block, entry.mediaId));
      const start = stageCursor?.phase === 'rounds' ? indexAfterCursor(entries, stageCursor, sort) : 0;
      const slice = entries.slice(start, start + remaining);
      for (const entry of slice) pieces.push({ entry });
      remaining -= slice.length;
      const last = slice.at(-1);
      if (remaining === 0 && last) {
        nextCursor = encodeRoundsCursor(stage.block, last);
        break;
      }
    } else {
      const after = stageCursor?.phase === 'rest' ? (stageCursor.after ?? undefined) : undefined;
      const response = await keysetPage(remaining, after, { ...restrictFor(stage.block), excludedIds: roundIds });
      const hits = response.hits.hits;
      for (const hit of hits) pieces.push({ hit });
      const last = hits.at(-1);
      // A full page may have more behind it in this stage; a short one means the stage is done.
      if (hits.length === remaining && last?.sort) {
        nextCursor = encodeRestCursor(stage.block, last.sort as estypes.FieldValue[]);
        remaining = 0;
        break;
      }
      remaining -= hits.length;
    }

    stageIndex++;
    stageCursor = undefined;
  }

  const roundEntries = pieces.flatMap((piece) => ('entry' in piece ? [piece.entry] : []));
  const [roundsResponse, mediaResult] = await Promise.all([
    roundEntries.length > 0
      ? client.search({
          index: INDEX_NAME,
          size: roundEntries.length,
          sort,
          highlight: { fields: highlightFields },
          query: { bool: { must: [query], filter: [buildIdsFilter(roundEntries.map((entry) => entry.id))] } },
        })
      : null,
    mediaInfo,
  ]);
  const roundHitsById = new Map((roundsResponse?.hits.hits ?? []).map((hit) => [hit._id, hit]));
  const hits = pieces.flatMap((piece) => {
    if ('hit' in piece) return [piece.hit];
    const hit = roundHitsById.get(piece.entry.id);
    return hit ? [hit] : [];
  });

  const combined = { hits: { total, hits } } as estypes.SearchResponse;
  const { segments, mediaMap } = SegmentResponse.buildSearchResultSegments(combined, mediaResult);
  return {
    segments,
    includes: { media: mediaMap },
    pagination: SegmentResponse.buildPagination(combined, nextCursor),
  };
}

function buildIdsFilter(segmentIds: Array<number | string>): estypes.QueryDslQueryContainer {
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
