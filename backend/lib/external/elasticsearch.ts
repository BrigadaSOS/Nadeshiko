import { Client, HttpConnection } from '@elastic/elasticsearch';
import type * as estypes from '@elastic/elasticsearch/lib/api/types';
import { config } from '@lib/config';
import { QueryMediaInfoResponse } from '@lib/types/queryMediaInfoResponse';
import { Media } from '@app/entities';
import { notEmpty } from '@lib/utils/utils';
import { getSegmentImageUrl, getSegmentAudioUrl, getSegmentVideoUrl } from '@lib/utils/storage';
import { secondsToTime } from '@lib/utils/time';
import { logger } from '@lib/utils/log';
import { QuerySegmentsRequest } from '@lib/types/querySegmentsRequest';
import { QuerySearchStatsRequest } from '@lib/types/querySearchStatsRequest';
import { QuerySurroundingSegmentsRequest } from '@lib/types/querySurroundingSegmentsRequest';
import { InvalidRequestError } from '@lib/utils/apiErrors';
import { getCachedSearchStatistics, setCachedSearchStatistics } from '@lib/cache/searchStatsCache';
import elasticsearchSchema from 'config/elasticsearch-schema.json';
import type {
  QueryStatsOutput,
  SearchResponseOutput,
  SearchStatsResponseOutput,
  SearchMultipleResponseOutput,
  FetchSentenceContextResponseOutput,
  SentenceOutput,
  StatisticOutput,
  WordMatchOutput,
  WordMatchMediaOutput,
} from 'generated/outputTypes';

/**
 * =============================================================================
 * ELASTICSEARCH SEARCH ARCHITECTURE
 * =============================================================================
 *
 * JAPANESE CONTENT FIELDS (3 fields for different matching strategies)
 * -----------------------------------------------------------------------------
 * | Field                 | Purpose                    | Example: "食べました"       |
 * |----------------------|----------------------------|----------------------------|
 * | content              | Exact text matching        | Tokens: 食べ, ました        |
 * | content.baseform     | Dictionary form matching   | Tokens: 食べる, ます        |
 * | content.kana         | Pronunciation/reading match| Tokens: タベ, マシタ        |
 * -----------------------------------------------------------------------------
 *
 * FIELD SELECTION BY INPUT TYPE (AUTO-DETECTED)
 * -----------------------------------------------------------------------------
 * | Input Type       | Fields (with boosts)                          | Rationale           |
 * |------------------|-----------------------------------------------|---------------------|
 * | Romaji (go)      | EN/ES^10, kana^3, content^2, base^1           | Prefer EN/ES        |
 * | Kanji (食べる)    | content^10, baseform^5 (NO kana)              | Avoid homophones    |
 * | Kana (たべる)     | content^10, baseform^5, kana^3                | Standard search     |
 * -----------------------------------------------------------------------------
 *
 * SCORING (boost_mode: replace for length-based, multiply for random)
 * -----------------------------------------------------------------------------
 * Length scoring (when minLength not specified):
 *   Uses gaussian (bell curve) distribution centered at 27 chars (μ=27, σ=6)
 *   - Provides smooth, organic scoring without artificial tier boundaries
 *   - Peak score (100) at ideal length (27 chars)
 *   - Score gradually decreases as length deviates from ideal
 *   - Floor score (10) for very short (<8) or very long (>50) sentences
 *
 *   Example distribution:
 *   27 chars → 100 (peak), 25-29 chars → 95-100, 21-33 chars → 80-95
 *   15-39 chars → 50-80, <15 or >39 chars → 10-50
 *
 * Language selection (dis_max with tie_breaker: 0.1):
 *   - Picks best matching language, 10% contribution from others
 *   - Reduces cross-language noise (was 30% in previous implementation)
 *
 * QUERY SYNTAX (supported via query_string)
 * -----------------------------------------------------------------------------
 * - AND, OR, NOT operators: "cat AND dog", "cat OR dog"
 * - Required/excluded: "+required -excluded"
 * - Phrase search: "exact phrase"
 * - Wildcards: "te*t" (no leading wildcards)
 * - Grouping: "(cat OR dog) AND bird"
 * =============================================================================
 */

enum InputScript {
  KANJI = 'kanji',
  KANA = 'kana',
  ROMAJI = 'romaji',
}

interface ScriptBoostConfig {
  japanese: number;
  japaneseBaseform: number;
  japaneseKana: number;
  english: number;
  spanish: number;
}

type QueryParserMode = 'strict' | 'safe';

export const client = new Client({
  node: config.ELASTICSEARCH_HOST,
  auth: {
    username: config.ELASTICSEARCH_USER,
    password: config.ELASTICSEARCH_PASSWORD,
  },
  Connection: HttpConnection,
});

const INDEX_NAME = config.ELASTICSEARCH_INDEX || elasticsearchSchema.index;
const IMPROVED_LENGTH_TIERS = buildImprovedLengthTiers();
type SearchStatisticsOutput = Pick<SearchStatsResponseOutput, 'mediaStatistics' | 'categoryStatistics'>;

/**
 * Create an admin client using ELASTICSEARCH_ADMIN_* credentials.
 * Only used for setup operations (creating users/roles).
 */
function createAdminClient(): Client {
  const adminUser = config.ELASTICSEARCH_ADMIN_USER || 'elastic';
  const adminPassword = config.ELASTICSEARCH_ADMIN_PASSWORD;

  if (!adminPassword) {
    throw new Error('ELASTICSEARCH_ADMIN_PASSWORD is required for admin operations');
  }

  return new Client({
    node: config.ELASTICSEARCH_HOST,
    auth: {
      username: adminUser,
      password: adminPassword,
    },
    Connection: HttpConnection,
  });
}

/**
 * Sets up the Elasticsearch application user and role.
 * Creates an index-scoped user that can only access the configured index.
 *
 * This function uses ADMIN credentials and is idempotent - safe to run multiple times.
 * By default, it will skip creation if the user already exists.
 *
 * @returns The username that was created (or already existed)
 */
export async function setupElasticsearchUser(options: { recreateIfExists?: boolean } = {}): Promise<string> {
  const { recreateIfExists = false } = options;
  const indexName = INDEX_NAME;
  const appUsername = config.ELASTICSEARCH_USER;
  const appPassword = config.ELASTICSEARCH_PASSWORD;

  // Skip if admin credentials not available
  if (!config.ELASTICSEARCH_ADMIN_PASSWORD) {
    logger.info('ELASTICSEARCH_ADMIN_PASSWORD not set, skipping user/role setup');
    return appUsername || 'elastic';
  }

  if (!appPassword) {
    throw new Error('ELASTICSEARCH_PASSWORD is required to create the application user');
  }

  // Generate username from index if not provided
  const username = appUsername || `${indexName.replace(/[^a-zA-Z0-9]/g, '_')}_user`;
  const roleName = `${username}_role`;

  const adminClient = createAdminClient();

  try {
    if (recreateIfExists) {
      logger.info({ username, roleName }, 'Recreating Elasticsearch app user and role');

      await adminClient.security.deleteUser({ username }).catch((error) => {
        if (error.meta.statusCode !== 404) {
          throw error;
        }
      });

      await adminClient.security.deleteRole({ name: roleName }).catch((error) => {
        if (error.meta.statusCode !== 404) {
          throw error;
        }
      });
    }

    // Check if user already exists
    const userExists = await adminClient.security
      .getUser({ username })
      .then(() => true)
      .catch((error) => {
        if (error.meta.statusCode === 404) return false;
        throw error;
      });

    if (userExists && !recreateIfExists) {
      logger.info({ username }, 'Elasticsearch user already exists, skipping creation');
      return username;
    }

    // Create role with index-scoped permissions
    logger.info({ roleName, indexName }, 'Creating Elasticsearch role');
    await adminClient.security.putRole({
      name: roleName,
      indices: [
        {
          names: [indexName],
          privileges: ['all'],
          allow_restricted_indices: false,
        },
      ],
    });

    // Create user with the role
    logger.info({ username, roleName }, 'Creating Elasticsearch user');
    await adminClient.security.putUser({
      username,
      password: appPassword,
      roles: [roleName],
      full_name: `Nadeshiko App User for ${indexName}`,
    });

    logger.info({ username, roleName, indexName }, 'Elasticsearch user and role created successfully');
    return username;
  } catch (error) {
    logger.error(error, 'Failed to setup Elasticsearch user/role');
    throw error;
  }
}

/**
 * Initializes the Elasticsearch index using the provided client.
 * If no client is provided, uses the default app user client.
 *
 * @param esClient Optional client to use (use admin client for setup)
 */
export async function initializeElasticsearchIndexWithClient(esClient?: Client): Promise<void> {
  const clientToUse = esClient || client;
  await initializeElasticsearchIndexInternal(clientToUse);
}

export async function initializeElasticsearchIndex(): Promise<void> {
  await initializeElasticsearchIndexWithClient(client);
}

export async function resetElasticsearchIndexWithClient(esClient?: Client): Promise<void> {
  const clientToUse = esClient || client;

  const indexExists = await clientToUse.indices.exists({ index: INDEX_NAME });
  if (indexExists) {
    logger.info(`Deleting Elasticsearch index '${INDEX_NAME}'`);
    await clientToUse.indices.delete({ index: INDEX_NAME });
  }

  logger.info(`Creating Elasticsearch index '${INDEX_NAME}' with mappings from config/elasticsearch-schema.json`);

  await clientToUse.indices.create({
    index: INDEX_NAME,
    settings: elasticsearchSchema.settings as any,
    mappings: elasticsearchSchema.mappings as any,
  });

  logger.info(`Elasticsearch index '${INDEX_NAME}' recreated successfully`);
}

export async function resetElasticsearchIndex(): Promise<void> {
  await resetElasticsearchIndexWithClient(client);
}

async function initializeElasticsearchIndexInternal(clientToUse: Client): Promise<void> {
  const indexExists = await clientToUse.indices.exists({ index: INDEX_NAME });
  if (indexExists) {
    logger.info(`Elasticsearch index '${INDEX_NAME}' already exists`);
    return;
  }

  logger.info(`Creating Elasticsearch index '${INDEX_NAME}' with mappings from config/elasticsearch-schema.json`);

  await clientToUse.indices.create({
    index: INDEX_NAME,
    settings: elasticsearchSchema.settings as any,
    mappings: elasticsearchSchema.mappings as any,
  });

  logger.info(`Elasticsearch index '${INDEX_NAME}' created successfully from config/elasticsearch-schema.json`);
}

function detectInputScript(query: string): InputScript {
  const hasKanji = /[\u4e00-\u9faf]/.test(query);
  const hasHiragana = /[\u3040-\u309f]/.test(query);
  const hasKatakana = /[\u30a0-\u30ff]/.test(query);

  if (hasKanji) {
    return InputScript.KANJI;
  }

  if (hasHiragana || hasKatakana) {
    return InputScript.KANA;
  }

  return InputScript.ROMAJI;
}

function getScriptBoosts(detectedScript: InputScript): ScriptBoostConfig {
  const boostConfigs: Record<InputScript, ScriptBoostConfig> = {
    [InputScript.KANJI]: {
      japanese: 10,
      japaneseBaseform: 5,
      japaneseKana: 0,
      english: 1,
      spanish: 1,
    },
    [InputScript.KANA]: {
      japanese: 10,
      japaneseBaseform: 5,
      japaneseKana: 3,
      english: 1,
      spanish: 1,
    },
    [InputScript.ROMAJI]: {
      japanese: 2,
      japaneseBaseform: 1,
      japaneseKana: 3,
      english: 10,
      spanish: 10,
    },
  };

  return boostConfigs[detectedScript];
}

function normalizeNumberArray(values?: readonly number[]): number[] {
  if (!values || values.length === 0) {
    return [];
  }

  return [...new Set(values)].sort((a, b) => a - b);
}

function normalizeStringArray(values?: readonly string[]): string[] {
  if (!values || values.length === 0) {
    return [];
  }

  return [...new Set(values)].sort();
}

function buildSearchStatsCacheKey(request: QuerySearchStatsRequest, parserMode: QueryParserMode): string {
  return JSON.stringify({
    parserMode,
    query: request.query ?? null,
    exactMatch: Boolean(request.exactMatch),
    minLength: request.minLength ?? null,
    maxLength: request.maxLength ?? null,
    status: normalizeNumberArray(request.status),
    category: normalizeStringArray(request.category),
    excludedAnimeIds: normalizeNumberArray(request.excludedAnimeIds),
  });
}

const buildStatisticsFromAggs = (
  aggResponse: estypes.SearchResponse,
  mediaInfoResponse: QueryMediaInfoResponse,
): StatisticOutput[] => {
  if (!aggResponse.aggregations || !('group_by_media_id' in aggResponse.aggregations)) {
    return [];
  }

  // @ts-expect-error -- elasticsearch aggregation type
  const mediaBuckets = aggResponse.aggregations['group_by_media_id'].buckets;
  return mediaBuckets
    .map((mediaBucket: { [x: string]: any }) => {
      const mediaInfo = mediaInfoResponse.results.get(Number(mediaBucket['key']));
      if (!mediaInfo || !Object.keys(mediaInfo).length) {
        return undefined;
      }

      // @ts-expect-error -- elasticsearch aggregation type
      const episodesWithResults = mediaBucket['group_by_episode'].buckets.reduce((episodesAcc, episodeBucket) => {
        episodesAcc[episodeBucket['key']] = episodeBucket['doc_count'];
        return episodesAcc;
      }, {});

      return {
        animeId: mediaBucket['key'],
        category: mediaInfo.category,
        nameAnimeRomaji: mediaInfo.romajiName,
        nameAnimeEn: mediaInfo.englishName,
        nameAnimeJp: mediaInfo.japaneseName,
        amountSentencesFound: mediaBucket['doc_count'],
        episodeHits: episodesWithResults,
      };
    })
    .filter(notEmpty);
};

const buildCategoryStatisticsFromAggs = (
  aggResponse: estypes.SearchResponse,
): SearchStatisticsOutput['categoryStatistics'] => {
  if (!aggResponse.aggregations || !('group_by_category' in aggResponse.aggregations)) {
    return [];
  }

  // @ts-expect-error -- elasticsearch aggregation type
  return aggResponse.aggregations['group_by_category'].buckets.map((bucket) => ({
    category: bucket['key'],
    count: bucket['doc_count'],
  }));
};

const querySearchStatisticsWithMustQueries = async (
  request: QuerySearchStatsRequest,
  mustQueries: estypes.QueryDslQueryContainer[],
  mediaInfoPromise: Promise<QueryMediaInfoResponse>,
  parserMode: QueryParserMode,
): Promise<SearchStatisticsOutput> => {
  const cacheKey = buildSearchStatsCacheKey(request, parserMode);
  const cached = getCachedSearchStatistics(cacheKey);
  if (cached) {
    return cached;
  }

  // Sidebar media dropdown: query + category filters
  const { filter: filterForMediaStatistics, must_not: must_notForMediaStatistics } = buildCommonFilters(request);

  const esMediaStatsResponse = client.search({
    size: 0,
    index: INDEX_NAME,
    query: {
      bool: {
        filter: filterForMediaStatistics,
        must: [...mustQueries],
        must_not: must_notForMediaStatistics,
      },
    },
    aggs: {
      group_by_media_id: {
        terms: {
          field: 'mediaId',
          size: 10000,
        },
        aggs: {
          group_by_episode: {
            terms: {
              field: 'episode',
              size: 10000,
            },
          },
        },
      },
    },
  });

  // Top category tabs: query filters only (category removed)
  const { filter: filterForCategoryStats, must_not: must_notForCategoryStats } = buildCommonFilters({
    ...request,
    category: undefined,
  });

  const esCategoryStatsResponse = client.search({
    size: 0,
    index: INDEX_NAME,
    query: {
      bool: {
        filter: filterForCategoryStats,
        must: [...mustQueries],
        must_not: must_notForCategoryStats,
      },
    },
    aggs: {
      group_by_category: {
        terms: {
          field: 'category',
          size: 10,
        },
      },
    },
  });

  const [esMediaStatsResult, esCategoryResult, mediaInfoResponse] = await Promise.all([
    esMediaStatsResponse,
    esCategoryStatsResponse,
    mediaInfoPromise,
  ]);

  const value: SearchStatisticsOutput = {
    mediaStatistics: buildStatisticsFromAggs(esMediaStatsResult, mediaInfoResponse),
    categoryStatistics: buildCategoryStatisticsFromAggs(esCategoryResult),
  };

  setCachedSearchStatistics(cacheKey, value);
  return value;
};

const buildSearchMustQueries = (
  request: Pick<QuerySegmentsRequest, 'uuid' | 'query' | 'exactMatch' | 'minLength' | 'maxLength'>,
  parserMode: QueryParserMode,
): {
  must: estypes.QueryDslQueryContainer[];
  isMatchAll: boolean;
  hasQuery: boolean;
} => {
  const must: estypes.QueryDslQueryContainer[] = [];

  if (request.uuid) {
    must.push({ match: { uuid: request.uuid } });
  }

  const isMatchAll = !request.uuid && !request.query;
  const hasQuery = !request.uuid && !!request.query;

  if (isMatchAll) {
    if (request.minLength === undefined && request.maxLength === undefined) {
      must.push({
        function_score: {
          query: { match_all: {} },
          functions: IMPROVED_LENGTH_TIERS,
          score_mode: 'first',
          boost_mode: 'replace',
        },
      });
    } else {
      must.push({ match_all: {} });
    }
  } else if (hasQuery) {
    const textQuery = buildTextSearchQuery(
      request.query as string,
      request.exactMatch || false,
      request.minLength !== undefined || request.maxLength !== undefined,
      parserMode,
    );
    must.push(textQuery);
  }

  return {
    must,
    isMatchAll,
    hasQuery,
  };
};

export const querySegments = async (
  request: QuerySegmentsRequest,
  parserMode: QueryParserMode = 'strict',
): Promise<SearchResponseOutput> => {
  if (request.minLength !== undefined && request.maxLength !== undefined && request.minLength > request.maxLength) {
    throw new InvalidRequestError('minLength cannot be greater than maxLength');
  }

  const { must, isMatchAll, hasQuery } = buildSearchMustQueries(request, parserMode);

  const { filter, must_not } = buildCommonFilters(request);

  if (request.media && request.media.length > 0) {
    filter.push(buildMediaFilter(request.media));
  }

  const { sort, randomScoreQuery } = buildSortAndRandomScore(request, isMatchAll);

  // Validate cursor length matches expected sort field count
  if (request.cursor && request.cursor.length > 0) {
    const sortArray = Array.isArray(sort) ? sort : [sort];
    const expectedCursorLength = sortArray.length;
    if (request.cursor.length !== expectedCursorLength) {
      throw new InvalidRequestError(
        `Cursor length mismatch: expected ${expectedCursorLength} values but got ${request.cursor.length}. ` +
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

  const esResponse = client.search({
    size: request.limit,
    sort,
    index: INDEX_NAME,
    highlight: {
      fields: {
        content: {
          matched_fields: ['content', 'content.kana', 'content.baseform'],
          type: 'fvh',
        },
        contentEnglish: {
          matched_fields: ['contentEnglish', 'contentEnglish.exact'],
          type: 'fvh',
        },
        contentSpanish: {
          matched_fields: ['contentSpanish', 'contentSpanish.exact'],
          type: 'fvh',
        },
      },
    },
    query: {
      bool: {
        filter,
        must,
        must_not,
      },
    },
    search_after: request.cursor,
  });

  const mediaInfo = Media.getMediaInfoMap();

  // Use Promise.all to ensure all rejections are caught together.
  // Awaiting sequentially causes unhandled rejections if an early promise rejects
  // before later ones are awaited.
  try {
    const [esResult, mediaResult] = await Promise.all([esResponse, mediaInfo]);
    return buildSearchAnimeSentencesResponse(esResult, mediaResult);
  } catch (error) {
    if (hasQuery && parserMode === 'strict' && isQuerySyntaxError(error)) {
      logger.warn({ query: request.query }, 'Invalid query syntax; retrying search with safe query parser');
      return querySegments(request, 'safe');
    }
    throw error;
  }
};

export const querySearchStats = async (
  request: QuerySearchStatsRequest,
  parserMode: QueryParserMode = 'strict',
): Promise<SearchStatsResponseOutput> => {
  if (request.minLength !== undefined && request.maxLength !== undefined && request.minLength > request.maxLength) {
    throw new InvalidRequestError('minLength cannot be greater than maxLength');
  }

  const { must, hasQuery } = buildSearchMustQueries(request, parserMode);
  const mediaInfo = Media.getMediaInfoMap();

  try {
    return await querySearchStatisticsWithMustQueries(request, must, mediaInfo, parserMode);
  } catch (error) {
    if (hasQuery && parserMode === 'strict' && isQuerySyntaxError(error)) {
      logger.warn({ query: request.query }, 'Invalid query syntax; retrying search stats with safe query parser');
      return querySearchStats(request, 'safe');
    }
    throw error;
  }
};

export const queryWordsMatched = async (
  words: string[],
  exactMatch: boolean,
  parserMode: QueryParserMode = 'strict',
): Promise<SearchMultipleResponseOutput> => {
  const searches: estypes.MsearchRequestItem[] = words.flatMap((word) => {
    return [
      {},
      {
        size: 0,
        query: buildMultiLanguageQuery(word, exactMatch, parserMode),
        aggs: {
          group_by_media_id: {
            terms: {
              field: 'mediaId',
            },
          },
        },
      },
    ];
  });

  let esResponse: estypes.MsearchResponse;
  try {
    esResponse = await client.msearch({
      index: INDEX_NAME,
      searches,
    });
  } catch (error) {
    if (parserMode === 'strict' && isQuerySyntaxError(error)) {
      logger.warn({ wordsCount: words.length }, 'Invalid query syntax in word match; retrying with safe query parser');
      return queryWordsMatched(words, exactMatch, 'safe');
    }
    throw error;
  }

  const mediaMapData = await Media.getMediaInfoMap();
  return buildQueryWordsMatchedResponse(words, esResponse, mediaMapData);
};

export const querySurroundingSegments = async (
  request: QuerySurroundingSegmentsRequest,
): Promise<FetchSentenceContextResponseOutput> => {
  const contextSearches: estypes.MsearchRequestItem[] = [
    {},
    {
      sort: [
        {
          position: {
            order: 'asc',
          },
        },
      ],
      size: request.limit ? request.limit + 1 : 16,
      query: buildUuidContextQuery(request.mediaId, request.episode, {
        range: {
          position: {
            gte: request.segmentPosition,
          },
        },
      }),
    },
    {},
    {
      sort: [
        {
          position: {
            order: 'desc',
          },
        },
      ],
      size: request.limit || 14,
      query: buildUuidContextQuery(request.mediaId, request.episode, {
        range: {
          position: {
            lt: request.segmentPosition,
          },
        },
      }),
    },
  ];

  const esResponse = await client.msearch({
    index: INDEX_NAME,
    searches: contextSearches,
  });

  const mediaMapData = await Media.getMediaInfoMap();
  const mediaInfo = mediaMapData;

  let previousSegments: SentenceOutput[] = [];
  let nextSegments: SentenceOutput[] = [];
  if (esResponse.responses[0].status) {
    previousSegments = buildSearchAnimeSentencesSegments(
      esResponse.responses[0] as estypes.SearchResponseBody,
      mediaInfo,
    );
  }

  if (esResponse.responses[1].status) {
    nextSegments = buildSearchAnimeSentencesSegments(esResponse.responses[1] as estypes.SearchResponseBody, mediaInfo);
  }
  const sortedSegments = [...previousSegments, ...nextSegments].sort(
    (a, b) => a.segmentInfo.position - b.segmentInfo.position,
  );

  return {
    sentences: sortedSegments,
  };
};

const buildSearchAnimeSentencesResponse = (
  esResponse: estypes.SearchResponse,
  mediaInfoResponse: QueryMediaInfoResponse,
): SearchResponseOutput => {
  const sentences: SentenceOutput[] = buildSearchAnimeSentencesSegments(esResponse, mediaInfoResponse);

  let cursor: number[] | undefined;
  if (esResponse.hits.hits.length >= 1) {
    const sortValue = esResponse.hits.hits[esResponse.hits.hits.length - 1]['sort'];
    if (sortValue) {
      cursor = sortValue as number[];
    }
  }

  const queryStats = buildQueryStats(esResponse, cursor);

  return {
    sentences,
    queryStats,
    cursor: cursor ?? undefined,
  } as SearchResponseOutput;
};

const buildQueryStats = (esResponse: estypes.SearchResponse, cursor?: number[]): QueryStatsOutput => {
  const totalHits = esResponse.hits.total;
  let estimatedTotalHits = 0;
  let estimatedTotalHitsRelation: 'eq' | 'gte' = 'eq';

  if (typeof totalHits === 'number') {
    estimatedTotalHits = totalHits;
  } else if (totalHits && typeof totalHits === 'object') {
    estimatedTotalHits = totalHits.value;
    estimatedTotalHitsRelation = totalHits.relation === 'gte' ? 'gte' : 'eq';
  }

  return {
    returnedCount: esResponse.hits.hits.length,
    hasMoreResults: Boolean(cursor),
    estimatedTotalHits,
    estimatedTotalHitsRelation,
  };
};

const buildSearchAnimeSentencesSegments = (
  esResponse: estypes.SearchResponse,
  mediaInfoResponse: QueryMediaInfoResponse,
): SentenceOutput[] => {
  // Helper to remove empty string properties from an object
  const removeEmptyStrings = (obj: any) => {
    Object.keys(obj).forEach((key) => {
      if (obj[key] === '') delete obj[key];
    });
    return obj;
  };

  return esResponse.hits.hits
    .map((hit: any) => {
      const data: any = hit['_source'];
      const highlight: any = hit['highlight'] || {};
      const mediaInfo = mediaInfoResponse.results.get(Number(data['mediaId']));

      const contentJpHighlight = 'content' in highlight ? highlight['content'][0] : '';
      const contentEnHighlight = 'contentEnglish' in highlight ? highlight['contentEnglish'][0] : '';
      const contentEsHighlight = 'contentSpanish' in highlight ? highlight['contentSpanish'][0] : '';

      if (!mediaInfo) {
        logger.error({ mediaId: data['mediaId'] }, 'Media Info not found');
        return null;
      }

      // Read hashedId and storage from Elasticsearch
      const hashedId = data['hashedId'] || '';
      const storage: 'local' | 'r2' = data['storage'] || 'r2';

      const segment = {
        mediaId: data['mediaId'],
        episode: data['episode'],
        storage: storage,
        hashedId: hashedId,
      };

      // Use storage utility for segment URLs
      const imagePath = hashedId ? getSegmentImageUrl(segment) : mediaInfo.cover || '';
      const audioPath = hashedId ? getSegmentAudioUrl(segment) : '';
      const videoPath = hashedId ? getSegmentVideoUrl(segment) : '';

      return {
        basicInfo: removeEmptyStrings({
          animeId: data['mediaId'],
          nameAnimeRomaji: mediaInfo.romajiName,
          nameAnimeEn: mediaInfo.englishName,
          nameAnimeJp: mediaInfo.japaneseName,
          cover: mediaInfo.cover,
          banner: mediaInfo.banner,
          episode: data['episode'],
          category: mediaInfo.category,
        }),
        segmentInfo: removeEmptyStrings({
          status: data['status'],
          uuid: data['uuid'],
          position: data['position'],
          startTime: secondsToTime(data['startSeconds']),
          endTime: secondsToTime(data['endSeconds']),
          contentJp: data['content'],
          contentJpHighlight,
          contentEn: data['contentEnglish'],
          contentEnHighlight,
          contentEnMt: data['contentEnglishMt'],
          contentEs: data['contentSpanish'],
          contentEsHighlight,
          contentEsMt: data['contentSpanishMt'],
          isNsfw: data['isNsfw'],
          actorJa: data['actorJa'],
          actorEn: data['actorEn'],
          actorEs: data['actorEs'],
        }),
        mediaInfo: removeEmptyStrings({
          pathImage: imagePath,
          pathAudio: audioPath,
          pathVideo: videoPath,
        }),
      };
    })
    .filter(notEmpty);
};

const buildQueryWordsMatchedResponse = (
  words: string[],
  esResponse: estypes.MsearchResponse,
  mediaInfoResponse: QueryMediaInfoResponse,
): SearchMultipleResponseOutput => {
  // Elasticsearch's responses are returned in the exact same order as the words array, so we can iterate them side by side
  const results: WordMatchOutput[] = [];

  for (const [word, response] of words.map((word, i): [string, estypes.SearchResponseBody] => [
    word,
    esResponse.responses[i] as estypes.SearchResponseBody,
  ])) {
    let isMatch = false;
    let totalMatches = 0;

    if (response.hits !== undefined && response.hits.total !== undefined) {
      isMatch = (response.hits.total as estypes.SearchTotalHits).value > 0;
      totalMatches = (response.hits.total as estypes.SearchTotalHits).value;
    }

    let media: WordMatchMediaOutput[] = [];
    if (response.aggregations && 'group_by_media_id' in response.aggregations) {
      const mediaBuckets =
        (response.aggregations as Record<string, { buckets?: unknown[] }>).group_by_media_id?.buckets ?? [];
      media = mediaBuckets
        .map((bucket: any): WordMatchMediaOutput | null => {
          const mediaInfo = mediaInfoResponse.results.get(Number(bucket['key']));

          // Skip if mediaId from Elasticsearch doesn't exist in database
          if (!mediaInfo) {
            return null;
          }

          return {
            mediaId: mediaInfo.mediaId,
            englishName: mediaInfo.englishName,
            japaneseName: mediaInfo.japaneseName,
            romajiName: mediaInfo.romajiName,
            matches: bucket['doc_count'],
          };
        })
        .filter((item: WordMatchMediaOutput | null): item is WordMatchMediaOutput => item !== null);
    }

    results.push({
      word,
      isMatch,
      totalMatches,
      media,
    });
  }

  return {
    results,
  };
};

const buildMultiLanguageQuery = (
  query: string,
  exactMatch: boolean,
  parserMode: QueryParserMode = 'strict',
): estypes.QueryDslQueryContainer => {
  const queryText = exactMatch ? `"${query}"` : query;
  const detectedScript = detectInputScript(query);
  const boosts = getScriptBoosts(detectedScript);

  const japaneseQuery = buildStringQuery({
    query: queryText,
    parserMode,
    analyzeWildcard: true,
    fields: [`content^${boosts.japanese}`, `content.baseform^${boosts.japaneseBaseform}`],
    quoteAnalyzer: 'ja_original_search_analyzer',
    defaultOperator: 'AND',
  });

  const languageQueries: estypes.QueryDslQueryContainer[] = [japaneseQuery];

  if (boosts.japaneseKana > 0) {
    languageQueries.push({
      ...buildStringQuery({
        query: queryText,
        parserMode,
        fields: [`content.kana^${boosts.japaneseKana}`],
        analyzer: 'ja_kana_search_analyzer',
        defaultOperator: 'AND',
      }),
    });
  }

  if (exactMatch) {
    languageQueries.push(
      ...[
        {
          multi_match: {
            query: query,
            fields: [`contentSpanish.exact^${boosts.spanish}`],
          },
        },
        {
          multi_match: {
            query: query,
            fields: [`contentEnglish.exact^${boosts.english}`],
          },
        },
      ],
    );
  } else {
    languageQueries.push(
      ...[
        {
          ...buildStringQuery({
            query,
            parserMode,
            analyzeWildcard: true,
            fields: [`contentSpanish^${boosts.spanish}`, 'contentSpanish.exact^1'],
            defaultOperator: 'AND' as estypes.QueryDslOperator,
            quoteFieldSuffix: '.exact',
          }),
        },
        {
          ...buildStringQuery({
            query,
            parserMode,
            analyzeWildcard: true,
            fields: [`contentEnglish^${boosts.english}`, 'contentEnglish.exact^1'],
            defaultOperator: 'AND' as estypes.QueryDslOperator,
            quoteFieldSuffix: '.exact',
          }),
        },
      ],
    );
  }

  return {
    dis_max: {
      queries: languageQueries,
      tie_breaker: 0.1,
    },
  };
};

const buildUuidContextQuery = (
  mediaId: number,
  episode: number,
  rangeQuery: estypes.QueryDslQueryContainer,
): estypes.QueryDslQueryContainer => {
  return {
    bool: {
      filter: [
        {
          term: {
            mediaId: mediaId,
          },
        },
        {
          term: {
            episode,
          },
        },
        rangeQuery,
      ],
    },
  };
};

type CommonFiltersRequest = Pick<
  QuerySegmentsRequest,
  'status' | 'minLength' | 'maxLength' | 'animeId' | 'excludedAnimeIds' | 'episode' | 'category'
>;

const buildCommonFilters = (
  request: CommonFiltersRequest,
): { filter: estypes.QueryDslQueryContainer[]; must_not: estypes.QueryDslQueryContainer[] } => {
  const filter: estypes.QueryDslQueryContainer[] = [];
  const must_not: estypes.QueryDslQueryContainer[] = [];

  filter.push({ terms: { status: request.status } });

  if (request.minLength !== undefined || request.maxLength !== undefined) {
    const rangeFilter: { gte?: number; lte?: number } = {};
    if (request.minLength !== undefined) rangeFilter.gte = request.minLength;
    if (request.maxLength !== undefined) rangeFilter.lte = request.maxLength;
    filter.push({ range: { contentLength: rangeFilter } });
  }

  if (request.animeId) {
    filter.push({ term: { mediaId: request.animeId } });
  }

  if (request.excludedAnimeIds && request.excludedAnimeIds.length > 0) {
    must_not.push({ terms: { mediaId: request.excludedAnimeIds } });
  }

  if (request.episode) {
    filter.push({ terms: { episode: request.episode } });
  }

  if (request.category && request.category.length > 0) {
    filter.push({ terms: { category: request.category } });
  }

  return { filter, must_not };
};

const buildSortAndRandomScore = (
  request: QuerySegmentsRequest,
  isMatchAll: boolean,
): { sort: estypes.Sort; randomScoreQuery: estypes.QueryDslQueryContainer | null } => {
  let sort: estypes.Sort = [];
  let randomScoreQuery: estypes.QueryDslQueryContainer | null = null;

  // Determine if we're using length-based scoring (no minLength filter)
  const useLengthScoring = request.minLength === undefined;

  if (request.lengthSortOrder === 'random') {
    // Generate a deterministic seed based on current day if not provided
    // This allows "random but repeatable" results within the same day
    const seed = request.randomSeed ?? Math.floor(Date.now() / (1000 * 60 * 60 * 24));

    randomScoreQuery = {
      function_score: {
        functions: [
          {
            random_score: {
              field: '_seq_no',
              seed: seed,
            },
          },
        ],
        boost_mode: isMatchAll ? 'replace' : 'multiply',
      },
    };
    sort = [{ _score: { order: 'desc' } }, { contentLength: { order: 'asc', unmapped_type: 'short' } }];
  } else if (request.lengthSortOrder === 'time_asc') {
    // Sort by time: earliest first (episode -> position)
    sort = [{ episode: { order: 'asc' as estypes.SortOrder } }, { position: { order: 'asc' as estypes.SortOrder } }];
  } else if (request.lengthSortOrder === 'time_desc') {
    // Sort by time: latest first (episode -> position, descending)
    sort = [{ episode: { order: 'desc' as estypes.SortOrder } }, { position: { order: 'desc' as estypes.SortOrder } }];
  } else if (!request.lengthSortOrder || request.lengthSortOrder === 'none') {
    // When browsing media without query and no length filter, sort by length score (25-30 chars prioritized)
    // Otherwise for match_all with minLength filter, sort by contentLength ascending
    if (isMatchAll && useLengthScoring) {
      sort = [{ _score: { order: 'desc' } }, { contentLength: { order: 'asc', unmapped_type: 'short' } }];
    } else if (isMatchAll) {
      sort = [{ contentLength: { order: 'asc', unmapped_type: 'short' } }];
    } else {
      sort = [{ _score: { order: 'desc' } }, { contentLength: { order: 'asc', unmapped_type: 'short' } }];
    }
  } else {
    sort = [{ contentLength: { order: request.lengthSortOrder as estypes.SortOrder, unmapped_type: 'short' } }];
  }

  return { sort: withStableSortTieBreakers(sort), randomScoreQuery };
};

const buildTextSearchQuery = (
  query: string,
  exactMatch: boolean,
  hasLengthConstraints: boolean,
  parserMode: QueryParserMode = 'strict',
): estypes.QueryDslQueryContainer => {
  const baseQuery = buildMultiLanguageQuery(query, exactMatch, parserMode);

  if (!hasLengthConstraints) {
    return {
      function_score: {
        query: baseQuery,
        functions: IMPROVED_LENGTH_TIERS,
        score_mode: 'first',
        boost_mode: 'replace',
      },
    };
  }

  return baseQuery;
};

function buildImprovedLengthTiers(): any[] {
  const mean = 27;
  const stddev = 6;
  const maxScore = 100;
  const minScore = 10;

  const buckets: any[] = [];

  for (let length = 1; length <= 80; length += 1) {
    const gaussianScore = maxScore * Math.exp(-0.5 * ((length - mean) / stddev) ** 2);
    const score = Math.max(minScore, Math.round(gaussianScore));

    buckets.push({
      filter: { range: { contentLength: { gte: length, lt: length + 1 } } },
      weight: score,
    });
  }

  buckets.push({
    filter: { range: { contentLength: { gte: 80 } } },
    weight: minScore,
  });

  return buckets;
}

function withStableSortTieBreakers(sort: estypes.Sort): estypes.Sort {
  const sortArray = (Array.isArray(sort) ? [...sort] : [sort]) as Record<string, any>[];
  const existingSortFields = new Set(
    sortArray.flatMap((item) => {
      if (!item || typeof item !== 'object') {
        return [];
      }
      return Object.keys(item);
    }),
  );

  const appendIfMissing = (field: string, spec: Record<string, unknown>) => {
    if (!existingSortFields.has(field)) {
      sortArray.push({ [field]: spec });
      existingSortFields.add(field);
    }
  };

  appendIfMissing('mediaId', { order: 'asc', unmapped_type: 'integer' });
  appendIfMissing('episode', { order: 'asc', unmapped_type: 'integer' });
  appendIfMissing('position', { order: 'asc', unmapped_type: 'integer' });

  return sortArray;
}

function buildStringQuery({
  query,
  parserMode,
  fields,
  defaultOperator,
  analyzeWildcard = false,
  analyzer,
  quoteAnalyzer,
  quoteFieldSuffix,
}: {
  query: string;
  parserMode: QueryParserMode;
  fields: string[];
  defaultOperator: estypes.QueryDslOperator;
  analyzeWildcard?: boolean;
  analyzer?: string;
  quoteAnalyzer?: string;
  quoteFieldSuffix?: string;
}): estypes.QueryDslQueryContainer {
  if (parserMode === 'safe') {
    return {
      simple_query_string: {
        query,
        fields,
        analyzer,
        analyze_wildcard: analyzeWildcard,
        default_operator: defaultOperator,
        quote_field_suffix: quoteFieldSuffix,
      },
    };
  }

  return {
    query_string: {
      query,
      analyze_wildcard: analyzeWildcard,
      allow_leading_wildcard: false,
      fuzzy_transpositions: false,
      fields,
      analyzer,
      default_operator: defaultOperator,
      quote_analyzer: quoteAnalyzer,
      quote_field_suffix: quoteFieldSuffix,
    },
  };
}

function isQuerySyntaxError(error: unknown): boolean {
  const elasticError = error as {
    message?: string;
    meta?: {
      body?: {
        error?: {
          type?: string;
          reason?: string;
          root_cause?: Array<{ type?: string; reason?: string }>;
          failed_shards?: Array<{ reason?: { type?: string; reason?: string } }>;
        };
      };
    };
  };

  const errorMeta = elasticError.meta?.body?.error;
  const errorCauses = [
    { type: errorMeta?.type, reason: errorMeta?.reason },
    ...(errorMeta?.root_cause ?? []),
    ...(errorMeta?.failed_shards?.map((item) => item.reason ?? {}) ?? []),
  ];

  if (errorCauses.some((cause) => cause.type === 'parse_exception' || cause.type === 'parsing_exception')) {
    return true;
  }

  const message = [elasticError.message, ...errorCauses.map((cause) => cause.reason)].join(' ').toLowerCase();
  return (
    message.includes('failed to parse query') ||
    message.includes('cannot parse') ||
    message.includes('lexical error') ||
    message.includes('token_mgr_error')
  );
}

const buildMediaFilter = (media: QuerySegmentsRequest['media']): estypes.QueryDslQueryContainer => {
  if (!media) return { match_all: {} };

  const mediaQueries: estypes.QueryDslQueryContainer[] = media.flatMap((mediaFilter) => {
    if (!mediaFilter.episodes) {
      return {
        bool: {
          must: [{ term: { mediaId: { value: mediaFilter.mediaId } } }],
        },
      };
    }

    return mediaFilter.episodes.map((episode) => ({
      bool: {
        must: [{ term: { mediaId: { value: mediaFilter.mediaId } } }, { term: { episode: { value: episode } } }],
      },
    }));
  });

  return { bool: { should: mediaQueries } };
};
