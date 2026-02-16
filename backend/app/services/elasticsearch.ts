import { Client, HttpConnection } from '@elastic/elasticsearch';
import type { estypes } from '@elastic/elasticsearch';
import { config } from '@config/config';
import { QueryMediaInfoResponse } from '@app/types/queryMediaInfoResponse';
import { Media } from '@app/models';
function notEmpty<TValue>(value: TValue | null | undefined): value is TValue {
  return value !== null && value !== undefined;
}
import { type Storage, getSegmentImageUrl, getSegmentAudioUrl, getSegmentVideoUrl } from '@lib/utils/storage';
import { secondsToTime } from '@lib/utils/time';
import { logger } from '@config/log';
import { QuerySegmentsRequest } from '@app/types/querySegmentsRequest';
import { QuerySearchStatsRequest } from '@app/types/querySearchStatsRequest';
import { QuerySurroundingSegmentsRequest } from '@app/types/querySurroundingSegmentsRequest';
import { InvalidRequestError } from '@app/errors';
import { Cache, createCacheNamespace } from '@lib/cache';
import elasticsearchSchema from 'config/elasticsearch-schema.json';
import type {
  PaginationInfoOutput,
  SearchResponseOutput,
  SearchStatsResponseOutput,
  SearchMultipleResponseOutput,
  SegmentContextResponseOutput,
  SearchResultOutput,
  MediaSearchStatsOutput,
  WordMatchOutput,
  WordMatchMediaOutput,
} from 'generated/outputTypes';

/**
 * =============================================================================
 * ELASTICSEARCH SEARCH ARCHITECTURE
 * =============================================================================
 *
 * JAPANESE CONTENT FIELDS (4 fields for different matching strategies)
 * -----------------------------------------------------------------------------
 * | Field                 | Purpose                    | Example: "食べました"       |
 * |----------------------|----------------------------|----------------------------|
 * | content              | Surface form matching      | Tokens: 食べ, ました        |
 * | content.baseform     | Dictionary form matching   | Tokens: 食べる, ます        |
 * | content.normalized   | Orthographic variant match | Normalized okurigana/script |
 * | content.kana         | Pronunciation/reading match| Tokens: タベ, マシタ        |
 * -----------------------------------------------------------------------------
 *
 * FIELD SELECTION BY INPUT TYPE (AUTO-DETECTED)
 * -----------------------------------------------------------------------------
 * | Input Type       | Fields (with boosts)                          | Rationale           |
 * |------------------|-----------------------------------------------|---------------------|
 * | Romaji (go)      | EN/ES^10, kana^3, content^2, norm^2, base^1   | Prefer EN/ES        |
 * | Kanji (食べる)    | content^10, baseform^5, norm^4 (NO kana)      | Avoid homophones    |
 * | Kana (たべる)     | content^10, baseform^5, norm^4, kana^3        | Standard search     |
 * -----------------------------------------------------------------------------
 *
 * SCORING (boost_mode: multiply for text queries, replace for match_all)
 * -----------------------------------------------------------------------------
 * Length scoring (when minLength not specified):
 *   Uses native ES gauss decay function centered at 27 chars
 *   - match_all: origin=27, scale=6, decay=0.5 (tight preference, replaces score)
 *   - text queries: origin=27, offset=10, scale=15, decay=0.5 (gentle tiebreaker)
 *     offset=10 means lengths 17-37 get NO penalty at all
 *     Beyond that, very gradual rolloff — match quality always dominates
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
  japaneseNormalized: number;
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
type SearchStatisticsOutput = Pick<SearchStatsResponseOutput, 'media' | 'categories'>;

export const SEARCH_STATS_CACHE = createCacheNamespace('searchStats');
const SEARCH_STATS_TTL_MS = 24 * 60 * 60 * 1000;

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
      japaneseNormalized: 4,
      japaneseKana: 0,
      english: 1,
      spanish: 1,
    },
    [InputScript.KANA]: {
      japanese: 10,
      japaneseBaseform: 5,
      japaneseNormalized: 4,
      japaneseKana: 3,
      english: 1,
      spanish: 1,
    },
    [InputScript.ROMAJI]: {
      japanese: 2,
      japaneseBaseform: 1,
      japaneseNormalized: 2,
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
    status: normalizeStringArray(request.status),
    category: normalizeStringArray(request.category),
    excludedMediaIds: normalizeNumberArray(request.excludedMediaIds),
    mediaIds: normalizeNumberArray(request.mediaIds),
  });
}

const buildStatisticsFromAggs = (
  aggResponse: estypes.SearchResponse,
  mediaInfoResponse: QueryMediaInfoResponse,
): MediaSearchStatsOutput[] => {
  if (!aggResponse.aggregations || !('group_by_media_id' in aggResponse.aggregations)) {
    return [];
  }

  const mediaAgg = aggResponse.aggregations[
    'group_by_media_id'
  ] as estypes.AggregationsTermsAggregateBase<estypes.AggregationsTermsBucketBase>;
  const mediaBuckets = (mediaAgg.buckets ?? []) as Array<Record<string, any>>;
  return mediaBuckets
    .map((mediaBucket) => {
      const mediaInfo = mediaInfoResponse.results.get(Number(mediaBucket['key']));
      if (!mediaInfo || !Object.keys(mediaInfo).length) {
        return undefined;
      }

      const episodeAgg = mediaBucket[
        'group_by_episode'
      ] as estypes.AggregationsTermsAggregateBase<estypes.AggregationsTermsBucketBase>;
      const episodeBuckets = (episodeAgg.buckets ?? []) as Array<Record<string, any>>;
      const episodesWithResults = episodeBuckets.reduce((episodesAcc: Record<string, number>, episodeBucket) => {
        episodesAcc[episodeBucket['key']] = episodeBucket['doc_count'];
        return episodesAcc;
      }, {});

      return {
        mediaId: Number(mediaBucket['key']),
        category: mediaInfo.category as MediaSearchStatsOutput['category'],
        nameRomaji: mediaInfo.nameRomaji,
        nameEn: mediaInfo.nameEn,
        nameJa: mediaInfo.nameJa,
        segmentCount: Number(mediaBucket['doc_count']),
        episodeHits: episodesWithResults,
      };
    })
    .filter(notEmpty);
};

const buildCategoryStatisticsFromAggs = (aggResponse: estypes.SearchResponse): SearchStatisticsOutput['categories'] => {
  if (!aggResponse.aggregations || !('group_by_category' in aggResponse.aggregations)) {
    return [];
  }

  const categoryAgg = aggResponse.aggregations[
    'group_by_category'
  ] as estypes.AggregationsTermsAggregateBase<estypes.AggregationsTermsBucketBase>;
  const categoryBuckets = (categoryAgg.buckets ?? []) as Array<Record<string, any>>;
  return categoryBuckets.map((bucket) => ({
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

  return Cache.fetch(SEARCH_STATS_CACHE, cacheKey, SEARCH_STATS_TTL_MS, async () => {
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

    return {
      media: buildStatisticsFromAggs(esMediaStatsResult, mediaInfoResponse),
      categories: buildCategoryStatisticsFromAggs(esCategoryResult),
    };
  });
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
          functions: [
            {
              gauss: {
                characterCount: {
                  origin: 27,
                  scale: 6,
                  decay: 0.5,
                },
              },
            },
          ],
          score_mode: 'sum',
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
        contentJa: {
          matched_fields: ['contentJa', 'contentJa.kana', 'contentJa.baseform', 'contentJa.normalized'],
          type: 'fvh',
        },
        contentEn: {
          matched_fields: ['contentEn', 'contentEn.exact'],
          type: 'fvh',
        },
        contentEs: {
          matched_fields: ['contentEs', 'contentEs.exact'],
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
  return withSafeQueryFallback(
    async () => {
      const [esResult, mediaResult] = await Promise.all([esResponse, mediaInfo]);
      return buildSearchResponse(esResult, mediaResult);
    },
    () => querySegments(request, 'safe'),
    {
      parserMode,
      hasQuery,
      warnContext: { query: request.query },
      warnMessage: 'Invalid query syntax; retrying search with safe query parser',
    },
  );
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

  return withSafeQueryFallback(
    () => querySearchStatisticsWithMustQueries(request, must, mediaInfo, parserMode),
    () => querySearchStats(request, 'safe'),
    {
      parserMode,
      hasQuery,
      warnContext: { query: request.query },
      warnMessage: 'Invalid query syntax; retrying search stats with safe query parser',
    },
  );
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

  return withSafeQueryFallback(
    async () => {
      const esResponse = await client.msearch({ index: INDEX_NAME, searches });
      const mediaMapData = await Media.getMediaInfoMap();
      return buildQueryWordsMatchedResponse(words, esResponse, mediaMapData);
    },
    () => queryWordsMatched(words, exactMatch, 'safe'),
    {
      parserMode,
      warnContext: { wordsCount: words.length },
      warnMessage: 'Invalid query syntax in word match; retrying with safe query parser',
    },
  );
};

export const querySurroundingSegments = async (
  request: QuerySurroundingSegmentsRequest,
): Promise<SegmentContextResponseOutput> => {
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
      query: buildUuidContextQuery(request.mediaId, request.episodeNumber, {
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
      query: buildUuidContextQuery(request.mediaId, request.episodeNumber, {
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

  let previousSegments: SearchResultOutput[] = [];
  let nextSegments: SearchResultOutput[] = [];
  if (esResponse.responses[0].status) {
    previousSegments = buildSearchResultSegments(esResponse.responses[0] as estypes.SearchResponseBody, mediaInfo);
  }

  if (esResponse.responses[1].status) {
    nextSegments = buildSearchResultSegments(esResponse.responses[1] as estypes.SearchResponseBody, mediaInfo);
  }
  const sortedSegments = [...previousSegments, ...nextSegments].sort((a, b) => a.segment.position - b.segment.position);

  return {
    segments: sortedSegments,
  };
};

const buildSearchResponse = (
  esResponse: estypes.SearchResponse,
  mediaInfoResponse: QueryMediaInfoResponse,
): SearchResponseOutput => {
  const results: SearchResultOutput[] = buildSearchResultSegments(esResponse, mediaInfoResponse);

  let cursor: number[] | undefined;
  if (esResponse.hits.hits.length >= 1) {
    const sortValue = esResponse.hits.hits[esResponse.hits.hits.length - 1]['sort'];
    if (sortValue) {
      cursor = sortValue as number[];
    }
  }

  const pagination = buildPaginationInfo(esResponse, cursor);

  return {
    results,
    pagination,
    cursor: cursor ?? undefined,
  } as SearchResponseOutput;
};

const buildPaginationInfo = (esResponse: estypes.SearchResponse, cursor?: number[]): PaginationInfoOutput => {
  const totalHits = esResponse.hits.total;
  let estimatedTotalHits = 0;
  let estimatedTotalHitsRelation: 'EXACT' | 'LOWER_BOUND' = 'EXACT';

  if (typeof totalHits === 'number') {
    estimatedTotalHits = totalHits;
  } else if (totalHits && typeof totalHits === 'object') {
    estimatedTotalHits = totalHits.value;
    estimatedTotalHitsRelation = totalHits.relation === 'gte' ? 'LOWER_BOUND' : 'EXACT';
  }

  return {
    pageSize: esResponse.hits.hits.length,
    hasMore: Boolean(cursor),
    estimatedTotalHits,
    estimatedTotalHitsRelation,
  };
};

const buildSearchResultSegments = (
  esResponse: estypes.SearchResponse,
  mediaInfoResponse: QueryMediaInfoResponse,
): SearchResultOutput[] => {
  return esResponse.hits.hits
    .map((hit: any) => {
      const data: any = hit['_source'];
      const highlight: any = hit['highlight'] || {};
      const mediaInfo = mediaInfoResponse.results.get(Number(data['mediaId']));

      const jaHighlight = 'contentJa' in highlight ? highlight['contentJa'][0] : undefined;
      const enHighlight = 'contentEn' in highlight ? highlight['contentEn'][0] : undefined;
      const esHighlight = 'contentEs' in highlight ? highlight['contentEs'][0] : undefined;

      if (!mediaInfo) {
        logger.error({ mediaId: data['mediaId'] }, 'Media Info not found');
        return null;
      }

      // Read hashedId and storage from Elasticsearch
      const hashedId = data['hashedId'] || '';
      const storage: Storage = (data['storage'] || 'R2').toUpperCase() as Storage;

      const segmentForUrls = {
        mediaId: data['mediaId'],
        episode: data['episode'],
        storage: storage,
        hashedId: hashedId,
        storageBasePath: mediaInfo.storageBasePath,
      };

      // Use storage utility for segment URLs
      const imageUrl = hashedId ? getSegmentImageUrl(segmentForUrls) : mediaInfo.cover || '';
      const audioUrl = hashedId ? getSegmentAudioUrl(segmentForUrls) : '';
      const videoUrl = hashedId ? getSegmentVideoUrl(segmentForUrls) : '';

      return {
        media: {
          mediaId: data['mediaId'],
          nameRomaji: mediaInfo.nameRomaji,
          nameEn: mediaInfo.nameEn,
          nameJa: mediaInfo.nameJa,
          coverUrl: mediaInfo.cover,
          bannerUrl: mediaInfo.banner,
          category: mediaInfo.category as 'ANIME' | 'JDRAMA',
        },
        segment: {
          status: data['status'],
          uuid: data['uuid'],
          position: data['position'],
          startTime: secondsToTime(data['startSeconds']),
          endTime: secondsToTime(data['endSeconds']),
          episodeNumber: data['episode'],
          textJa: {
            content: data['contentJa'],
            ...(jaHighlight ? { highlight: jaHighlight } : {}),
          },
          textEn: {
            content: data['contentEn'] || undefined,
            ...(enHighlight ? { highlight: enHighlight } : {}),
            isMachineTranslated: data['contentEnMt'] ?? false,
          },
          textEs: {
            content: data['contentEs'] || undefined,
            ...(esHighlight ? { highlight: esHighlight } : {}),
            isMachineTranslated: data['contentEsMt'] ?? false,
          },
          isNsfw: data['isNsfw'],
          morphemes: data['morphemes'] || undefined,
        },
        urls: {
          ...(imageUrl ? { imageUrl } : {}),
          ...(audioUrl ? { audioUrl } : {}),
          ...(videoUrl ? { videoUrl } : {}),
        },
      };
    })
    .filter(notEmpty);
};

export const querySegmentsByUuids = async (uuids: string[]): Promise<SearchResultOutput[]> => {
  if (uuids.length === 0) return [];

  const esResponse = await client.search({
    index: INDEX_NAME,
    size: uuids.length,
    query: {
      terms: { uuid: uuids },
    },
  });

  const mediaInfo = await Media.getMediaInfoMap();
  return buildSearchResultSegments(esResponse, mediaInfo);
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
    let matchCount = 0;

    if (response.hits !== undefined && response.hits.total !== undefined) {
      isMatch = (response.hits.total as estypes.SearchTotalHits).value > 0;
      matchCount = (response.hits.total as estypes.SearchTotalHits).value;
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
            nameEn: mediaInfo.nameEn,
            nameJa: mediaInfo.nameJa,
            nameRomaji: mediaInfo.nameRomaji,
            matchCount: bucket['doc_count'],
          };
        })
        .filter((item: WordMatchMediaOutput | null): item is WordMatchMediaOutput => item !== null);
    }

    results.push({
      word,
      isMatch,
      matchCount,
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
    fields: [
      `contentJa^${boosts.japanese}`,
      `contentJa.baseform^${boosts.japaneseBaseform}`,
      `contentJa.normalized^${boosts.japaneseNormalized}`,
    ],
    quoteAnalyzer: 'ja_surface_search_analyzer',
    defaultOperator: 'AND',
  });

  const languageQueries: estypes.QueryDslQueryContainer[] = [japaneseQuery];

  if (boosts.japaneseKana > 0) {
    languageQueries.push({
      ...buildStringQuery({
        query: queryText,
        parserMode,
        fields: [`contentJa.kana^${boosts.japaneseKana}`],
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
            fields: [`contentEs.exact^${boosts.spanish}`],
          },
        },
        {
          multi_match: {
            query: query,
            fields: [`contentEn.exact^${boosts.english}`],
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
            fields: [`contentEs^${boosts.spanish}`, 'contentEs.exact^1'],
            defaultOperator: 'AND' as estypes.QueryDslOperator,
            quoteFieldSuffix: '.exact',
          }),
        },
        {
          ...buildStringQuery({
            query,
            parserMode,
            analyzeWildcard: true,
            fields: [`contentEn^${boosts.english}`, 'contentEn.exact^1'],
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
  'status' | 'minLength' | 'maxLength' | 'mediaId' | 'excludedMediaIds' | 'episode' | 'category'
> & {
  mediaIds?: number[];
};

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
    filter.push({ range: { characterCount: rangeFilter } });
  }

  if (request.mediaId) {
    filter.push({ term: { mediaId: request.mediaId } });
  }

  if (request.mediaIds && request.mediaIds.length > 0) {
    filter.push({ terms: { mediaId: request.mediaIds } });
  }

  if (request.excludedMediaIds && request.excludedMediaIds.length > 0) {
    must_not.push({ terms: { mediaId: request.excludedMediaIds } });
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

  // Normalize sort order to lowercase for comparison (API sends uppercase: ASC, DESC, NONE, etc.)
  const sortOrder = request.lengthSortOrder?.toLowerCase();

  if (sortOrder === 'random') {
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
    sort = [{ _score: { order: 'desc' } }, { characterCount: { order: 'asc', unmapped_type: 'short' } }];
  } else if (sortOrder === 'time_asc') {
    // Sort by time: earliest first (episode -> position)
    sort = [{ episode: { order: 'asc' as estypes.SortOrder } }, { position: { order: 'asc' as estypes.SortOrder } }];
  } else if (sortOrder === 'time_desc') {
    // Sort by time: latest first (episode -> position, descending)
    sort = [{ episode: { order: 'desc' as estypes.SortOrder } }, { position: { order: 'desc' as estypes.SortOrder } }];
  } else if (!sortOrder || sortOrder === 'none') {
    // When browsing media without query and no length filter, sort by length score (25-30 chars prioritized)
    // Otherwise for match_all with minLength filter, sort by characterCount ascending
    if (isMatchAll && useLengthScoring) {
      sort = [{ _score: { order: 'desc' } }, { characterCount: { order: 'asc', unmapped_type: 'short' } }];
    } else if (isMatchAll) {
      sort = [{ characterCount: { order: 'asc', unmapped_type: 'short' } }];
    } else {
      sort = [{ _score: { order: 'desc' } }, { characterCount: { order: 'asc', unmapped_type: 'short' } }];
    }
  } else {
    sort = [{ characterCount: { order: sortOrder as estypes.SortOrder, unmapped_type: 'short' } }];
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
        functions: [
          {
            gauss: {
              characterCount: {
                origin: 27,
                offset: 10,
                scale: 15,
                decay: 0.5,
              },
            },
          },
        ],
        score_mode: 'sum',
        boost_mode: 'multiply',
      },
    };
  }

  return baseQuery;
};

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

async function withSafeQueryFallback<T>(
  fn: () => Promise<T>,
  retry: () => Promise<T>,
  opts: { parserMode: QueryParserMode; hasQuery?: boolean; warnContext: Record<string, unknown>; warnMessage: string },
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (opts.parserMode === 'strict' && (opts.hasQuery ?? true) && isQuerySyntaxError(error)) {
      logger.warn(opts.warnContext, opts.warnMessage);
      return retry();
    }
    throw error;
  }
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
