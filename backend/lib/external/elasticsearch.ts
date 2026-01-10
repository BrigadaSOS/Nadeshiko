import { Client, HttpConnection } from '@elastic/elasticsearch';
import type { estypes } from '@elastic/elasticsearch';
import { QueryMediaInfoResponse } from '@lib/types/queryMediaInfoResponse';
import { Media } from '@app/entities';
import { notEmpty } from '@lib/utils/utils';
import { getSegmentImageUrl, getSegmentAudioUrl, getSegmentVideoUrl } from '@lib/utils/storage';
import { secondsToTime } from '@lib/utils/time';
import { logger } from '@lib/utils/log';
import { QuerySegmentsRequest } from '@lib/types/querySegmentsRequest';
import { QuerySurroundingSegmentsRequest } from '@lib/types/querySurroundingSegmentsRequest';
import { InvalidRequestError } from '@lib/utils/apiErrors';
import elasticsearchSchema from 'config/elasticsearch-schema.json';
import type {
  SearchResponseOutput,
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
 * | content.readingform  | Pronunciation/reading match| Tokens: タベ, マシタ        |
 * -----------------------------------------------------------------------------
 *
 * FIELD SELECTION BY INPUT TYPE (AUTO-DETECTED)
 * -----------------------------------------------------------------------------
 * | Input Type       | Fields (with boosts)                          | Rationale           |
 * |------------------|-----------------------------------------------|---------------------|
 * | Romaji (go)      | EN/ES^10, readingform^3, content^2, base^1    | Prefer EN/ES        |
 * | Kanji (食べる)    | content^10, baseform^5 (NO readingform)       | Avoid homophones    |
 * | Kana (たべる)     | content^10, baseform^5, readingform^3         | Standard search     |
 * -----------------------------------------------------------------------------
 *
 * SCORING (boost_mode: replace for length-based, multiply for random)
 * -----------------------------------------------------------------------------
 * Length scoring (when min_length not specified):
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
  japaneseReadingform: number;
  english: number;
  spanish: number;
}

export const client = new Client({
  node: process.env.ELASTICSEARCH_HOST,
  auth: {
    username: process.env.ELASTICSEARCH_USERNAME || 'elastic',
    password: process.env.ELASTICSEARCH_PASSWORD || '',
  },
  Connection: HttpConnection,
});

const INDEX_NAME = process.env.ELASTICSEARCH_INDEX || elasticsearchSchema.index;

export async function initializeElasticsearchIndex(): Promise<void> {
  const indexExists = await client.indices.exists({ index: INDEX_NAME });

  if (indexExists) {
    logger.info(`Elasticsearch index '${INDEX_NAME}' already exists`);
    return;
  }

  logger.info(`Creating Elasticsearch index '${INDEX_NAME}' with mappings from config/elasticsearch-schema.json`);

  await client.indices.create({
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
      japaneseReadingform: 0,
      english: 1,
      spanish: 1,
    },
    [InputScript.KANA]: {
      japanese: 10,
      japaneseBaseform: 5,
      japaneseReadingform: 3,
      english: 1,
      spanish: 1,
    },
    [InputScript.ROMAJI]: {
      japanese: 2,
      japaneseBaseform: 1,
      japaneseReadingform: 3,
      english: 10,
      spanish: 10,
    },
  };

  return boostConfigs[detectedScript];
}

export const querySegments = async (request: QuerySegmentsRequest): Promise<SearchResponseOutput> => {
  if (request.min_length !== undefined && request.max_length !== undefined && request.min_length > request.max_length) {
    throw new InvalidRequestError('min_length cannot be greater than max_length');
  }

  const must: estypes.QueryDslQueryContainer[] = [];

  if (request.uuid) {
    must.push({ match: { uuid: request.uuid } });
  }

  const isMatchAll = !request.uuid && !request.query;
  const hasQuery = !request.uuid && !!request.query;

  if (isMatchAll) {
    if (request.min_length === undefined && request.max_length === undefined) {
      must.push({
        function_score: {
          query: { match_all: {} },
          functions: buildImprovedLengthTiers(),
          score_mode: 'first',
          boost_mode: 'replace',
        },
      });
    } else {
      must.push({ match_all: {} });
    }
  } else if (hasQuery) {
    const textQuery = buildTextSearchQuery(
      request.query!,
      request.exact_match || false,
      request.min_length !== undefined || request.max_length !== undefined,
    );
    must.push(textQuery);
  }

  const { filter, must_not } = buildCommonFilters(request);

  if (hasQuery && request.media) {
    filter.push(buildMediaFilter(request.media));
  }

  const { sort, randomScoreQuery } = buildSortAndRandomScore(request, isMatchAll);

  if (randomScoreQuery && (isMatchAll || hasQuery)) {
    const lastQuery = must.pop();
    if (lastQuery) {
      (randomScoreQuery.function_score as any).query = lastQuery;
      must.push(randomScoreQuery);
    }
  }

  // Create filters for statistics (without media, season, episode filters) - used for sidebar
  // This shows all titles matching the query + category filter, but with all seasons/episodes
  const { filter: filterForStatistics, must_not: must_notForStatistics } = buildCommonFilters(request);
  // Remove anime_id/media, season, and episode filters from statistics filter (for sidebar)
  const filterForStatisticsWithoutMedia = filterForStatistics.filter(
    (f) =>
      !('term' in f && f.term && 'mediaId' in f.term) && // Remove media filter
      !('terms' in f && f.terms && ('season' in f.terms || 'episode' in f.terms)), // Remove season/episode filters
  );
  const mustForStatistics = [...must];

  const esNoHitsNoFiltersResponse = client.search({
    size: 0,
    sort,
    index: process.env.ELASTICSEARCH_INDEX,
    highlight: {
      fields: {
        content: {
          matched_fields: ['content', 'content.readingform', 'content.baseform'],
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
        filter: filterForStatisticsWithoutMedia,
        must: mustForStatistics,
        must_not: must_notForStatistics,
      },
    },
    search_after: request.cursor,
    aggs: {
      group_by_category: {
        terms: {
          field: 'Media.category',
          size: 10000,
        },
        aggs: {
          group_by_media_id: {
            terms: {
              field: 'mediaId',
              size: 10000,
            },
            aggs: {
              group_by_season: {
                terms: {
                  field: 'season',
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
          },
        },
      },
    },
  });

  // Create filters for category statistics (with media filter, without category/season/episode filters) - used for top tabs
  // This shows categories for the query + media filter, with all seasons/episodes
  const { filter: filterForCategoryStats, must_not: must_notForCategoryStats } = buildCommonFilters({
    ...request,
    category: undefined, // Remove category filter for category statistics
    season: undefined, // Remove season filter for category statistics
    episode: undefined, // Remove episode filter for category statistics
  });
  const filterWithMediaForCategoryStats = [...filterForCategoryStats];
  const mustForCategoryStats = [...must];
  if (hasQuery && request.media) {
    filterWithMediaForCategoryStats.push(buildMediaFilter(request.media));
  }

  const esCategoryStatsResponse = client.search({
    size: 0,
    index: process.env.ELASTICSEARCH_INDEX,
    query: {
      bool: {
        filter: filterWithMediaForCategoryStats,
        must: mustForCategoryStats,
        must_not: must_notForCategoryStats,
      },
    },
    aggs: {
      group_by_category: {
        terms: {
          field: 'Media.category',
          size: 10000,
        },
        aggs: {
          group_by_media_id: {
            terms: {
              field: 'mediaId',
              size: 10000,
            },
            aggs: {
              group_by_season: {
                terms: {
                  field: 'season',
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
          },
        },
      },
    },
  });

  const esResponse = client.search({
    size: request.limit,
    sort,
    index: process.env.ELASTICSEARCH_INDEX,
    highlight: {
      fields: {
        content: {
          matched_fields: ['content', 'content.readingform', 'content.baseform'],
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
    aggs: {
      group_by_media_id: {
        terms: {
          field: 'mediaId',
          size: 10000,
        },
      },
    },
  });

  const mediaInfo = Media.getMediaInfoMap();

  // Use Promise.all to ensure all rejections are caught together.
  // Awaiting sequentially causes unhandled rejections if an early promise rejects
  // before later ones are awaited.
  const [esResult, mediaResult, esNoHitsResult, esCategoryResult] = await Promise.all([
    esResponse,
    mediaInfo,
    esNoHitsNoFiltersResponse,
    esCategoryStatsResponse,
  ]);

  return buildSearchAnimeSentencesResponse(esResult, mediaResult, esNoHitsResult, esCategoryResult, request);
};

export const queryWordsMatched = async (
  words: string[],
  exact_match: boolean,
): Promise<SearchMultipleResponseOutput> => {
  const searches: estypes.MsearchRequestItem[] = words
    .map((word) => {
      return [
        {},
        {
          size: 0,
          query: buildMultiLanguageQuery(word, exact_match),
          aggs: {
            group_by_media_id: {
              terms: {
                field: 'mediaId',
              },
            },
          },
        },
      ];
    })
    .flat();

  const esResponse = await client.msearch({
    index: process.env.ELASTICSEARCH_INDEX,
    searches,
  });

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
      query: buildUuidContextQuery(request.media_id, request.season, request.episode, {
        range: {
          position: {
            gte: request.segment_position,
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
      query: buildUuidContextQuery(request.media_id, request.season, request.episode, {
        range: {
          position: {
            lt: request.segment_position,
          },
        },
      }),
    },
  ];

  const esResponse = await client.msearch({
    index: process.env.ELASTICSEARCH_INDEX,
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
  esNoHitsNoFiltersResponse: estypes.SearchResponse,
  esCategoryStatsResponse: estypes.SearchResponse,
  request: QuerySegmentsRequest,
): SearchResponseOutput => {
  const sentences: SentenceOutput[] = buildSearchAnimeSentencesSegments(esResponse, mediaInfoResponse);

  // Build category statistics from esCategoryStatsResponse (filtered by media, not by category)
  let categoryStatistics = [];
  if (esCategoryStatsResponse.aggregations && 'group_by_category' in esCategoryStatsResponse.aggregations) {
    // @ts-expect-error -- elasticsearch aggregation type
    categoryStatistics = esCategoryStatsResponse.aggregations['group_by_category'].buckets.map((bucket) => ({
      category: bucket['key'],
      count: bucket['doc_count'],
    }));
  }

  // Helper function to build statistics from aggregation response
  const buildStatisticsFromAggs = (aggResponse: estypes.SearchResponse): StatisticOutput[] => {
    if (!aggResponse.aggregations || !('group_by_category' in aggResponse.aggregations)) {
      return [];
    }
    // @ts-expect-error -- elasticsearch aggregation type
    return aggResponse.aggregations['group_by_category'].buckets.flatMap((categoryBucket) => {
      return categoryBucket.group_by_media_id.buckets
        .map((mediaBucket: { [x: string]: any }) => {
          const mediaInfo = mediaInfoResponse.results.get(Number(mediaBucket['key']));
          if (!mediaInfo || !Object.keys(mediaInfo).length) {
            return undefined;
          }
          // @ts-expect-error -- elasticsearch aggregation type
          const seasonsWithResults = mediaBucket['group_by_season'].buckets.reduce((seasonsAcc, seasonBucket) => {
            // @ts-expect-error -- elasticsearch aggregation type
            const episodes = seasonBucket['group_by_episode'].buckets.reduce((episodesAcc, episodeBucket) => {
              episodesAcc[episodeBucket['key']] = episodeBucket['doc_count'];
              return episodesAcc;
            }, {});

            seasonsAcc[seasonBucket['key']] = episodes;
            return seasonsAcc;
          }, {});

          return {
            animeId: mediaBucket['key'],
            category: mediaInfo.category,
            nameAnimeRomaji: mediaInfo.romajiName,
            nameAnimeEn: mediaInfo.englishName,
            nameAnimeJp: mediaInfo.japaneseName,
            amountSentencesFound: mediaBucket['doc_count'],
            seasonWithEpisodeHits: seasonsWithResults,
          };
        })
        .filter(notEmpty);
    });
  };

  // Build statistics from esNoHitsNoFiltersResponse (filtered by category, not by media) - for sidebar
  const statistics: StatisticOutput[] = buildStatisticsFromAggs(esNoHitsNoFiltersResponse);

  let cursor: number[] | undefined = undefined;
  if (esResponse.hits.hits.length >= 1) {
    const sortValue = esResponse.hits.hits[esResponse.hits.hits.length - 1]['sort'];
    if (sortValue) {
      cursor = sortValue as number[];
    }
  }

  if (!request?.extra) {
    return {
      statistics: [],
      categoryStatistics: [],
      sentences,
      cursor: cursor ?? undefined,
    } as SearchResponseOutput;
  } else {
    return {
      statistics: statistics,
      categoryStatistics: categoryStatistics,
      sentences,
      cursor: cursor ?? undefined,
    } as SearchResponseOutput;
  }
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
    .map((hit) => {
      const data: any = hit['_source'];
      const highlight: any = hit['highlight'] || {};
      const mediaInfo = mediaInfoResponse.results.get(Number(data['mediaId']));

      const contentJpHighlight = 'content' in highlight ? highlight['content'][0] : '';
      const contentEnHighlight = 'contentEnglish' in highlight ? highlight['contentEnglish'][0] : '';
      const contentEsHighlight = 'contentSpanish' in highlight ? highlight['contentSpanish'][0] : '';

      if (!mediaInfo) {
        logger.error({ mediaId: data['mediaId'] }, 'Media Info not found');
        return;
      }

      // Extract hashed_id from path_image or path_audio (remove extension)
      // ES stores just filename like '0d39e46b14.webp'
      const hashedId = data['path_image']?.replace(/\.[^.]+$/, '') || data['path_audio']?.replace(/\.[^.]+$/, '') || '';

      const segment = {
        mediaId: data['mediaId'],
        episode: data['episode'],
        storage: 'r2' as const, // Default to r2, could be enhanced to read from ES if needed
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
          season: data['season'],
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
    let is_match = false;
    let total_matches = 0;

    if (response.hits !== undefined && response.hits.total !== undefined) {
      is_match = (response.hits.total as estypes.SearchTotalHits).value > 0;
      total_matches = (response.hits.total as estypes.SearchTotalHits).value;
    }

    let media: WordMatchMediaOutput[] = [];
    if (response.aggregations && 'group_by_media_id' in response.aggregations) {
      // @ts-expect-error -- elasticsearch aggregation type
      media = response.aggregations['group_by_media_id'].buckets
        .map((bucket: any): WordMatchMediaOutput | null => {
          const mediaInfo = mediaInfoResponse.results.get(Number(bucket['key']));

          // Skip if media_id from Elasticsearch doesn't exist in database
          if (!mediaInfo) {
            return null;
          }

          return {
            media_id: mediaInfo.mediaId,
            english_name: mediaInfo.englishName,
            japanese_name: mediaInfo.japaneseName,
            romaji_name: mediaInfo.romajiName,
            matches: bucket['doc_count'],
          };
        })
        .filter((item: WordMatchMediaOutput | null): item is WordMatchMediaOutput => item !== null);
    }

    results.push({
      word,
      is_match,
      total_matches,
      media,
    });
  }

  return {
    results,
  };
};

const buildMultiLanguageQuery = (query: string, exact_match: boolean): estypes.QueryDslQueryContainer => {
  const queryText = exact_match ? `"${query}"` : query;
  const detectedScript = detectInputScript(query);
  const boosts = getScriptBoosts(detectedScript);

  const japaneseQuery: estypes.QueryDslQueryContainer = {
    query_string: {
      query: queryText,
      analyze_wildcard: true,
      allow_leading_wildcard: false,
      fuzzy_transpositions: false,
      fields: [`content^${boosts.japanese}`, `content.baseform^${boosts.japaneseBaseform}`],
      default_operator: 'AND',
      quote_analyzer: 'ja_original_search_analyzer',
    },
  };

  const languageQueries: estypes.QueryDslQueryContainer[] = [japaneseQuery];

  if (boosts.japaneseReadingform > 0) {
    languageQueries.push({
      query_string: {
        query: queryText,
        allow_leading_wildcard: false,
        fuzzy_transpositions: false,
        fields: [`content.readingform^${boosts.japaneseReadingform}`],
        default_operator: 'AND',
        analyzer: 'ja_readingform_search_analyzer',
      },
    });
  }

  if (exact_match) {
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
          query_string: {
            query,
            analyze_wildcard: true,
            allow_leading_wildcard: false,
            fuzzy_transpositions: false,
            fields: [`contentSpanish^${boosts.spanish}`, 'contentSpanish.exact^1'],
            default_operator: 'AND' as estypes.QueryDslOperator,
            quote_field_suffix: '.exact',
          },
        },
        {
          query_string: {
            query,
            analyze_wildcard: true,
            allow_leading_wildcard: false,
            fuzzy_transpositions: false,
            fields: [`contentEnglish^${boosts.english}`, 'contentEnglish.exact^1'],
            default_operator: 'AND' as estypes.QueryDslOperator,
            quote_field_suffix: '.exact',
          },
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
  season: number,
  episode: number,
  rangeQuery: estypes.QueryDslQueryContainer,
): estypes.QueryDslQueryContainer => {
  return {
    bool: {
      filter: [
        {
          term: {
            media_id: mediaId,
          },
        },
        {
          term: {
            season,
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

const buildCommonFilters = (
  request: QuerySegmentsRequest,
): { filter: estypes.QueryDslQueryContainer[]; must_not: estypes.QueryDslQueryContainer[] } => {
  const filter: estypes.QueryDslQueryContainer[] = [];
  const must_not: estypes.QueryDslQueryContainer[] = [];

  filter.push({ terms: { status: request.status } });

  if (request.min_length !== undefined || request.max_length !== undefined) {
    const rangeFilter: { gte?: number; lte?: number } = {};
    if (request.min_length !== undefined) rangeFilter.gte = request.min_length;
    if (request.max_length !== undefined) rangeFilter.lte = request.max_length;
    filter.push({ range: { contentLength: rangeFilter } });
  }

  if (request.anime_id) {
    filter.push({ term: { mediaId: request.anime_id } });
  }

  if (request.excluded_anime_ids && request.excluded_anime_ids.length > 0) {
    must_not.push({ terms: { mediaId: request.excluded_anime_ids } });
  }

  if (request.season) {
    filter.push({ terms: { season: request.season } });
  }

  if (request.episode) {
    filter.push({ terms: { episode: request.episode } });
  }

  if (request.category && request.category.length > 0) {
    filter.push({ terms: { 'Media.category': request.category } });
  }

  return { filter, must_not };
};

const buildSortAndRandomScore = (
  request: QuerySegmentsRequest,
  isMatchAll: boolean,
): { sort: estypes.Sort; randomScoreQuery: estypes.QueryDslQueryContainer | null } => {
  let sort: estypes.Sort = [];
  let randomScoreQuery: estypes.QueryDslQueryContainer | null = null;

  // Determine if we're using length-based scoring (no min_length filter)
  const useLengthScoring = request.min_length === undefined;

  if (request.length_sort_order === 'random') {
    // Generate a deterministic seed based on current day if not provided
    // This allows "random but repeatable" results within the same day
    const seed = request.random_seed ?? Math.floor(Date.now() / (1000 * 60 * 60 * 24));

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
    sort = [{ _score: { order: 'desc' } }, { contentLength: { order: 'asc' } }];
  } else if (request.length_sort_order === 'time_asc') {
    // Sort by time: earliest first (season -> episode -> position)
    sort = [
      { season: { order: 'asc' as estypes.SortOrder } },
      { episode: { order: 'asc' as estypes.SortOrder } },
      { position: { order: 'asc' as estypes.SortOrder } },
    ];
  } else if (request.length_sort_order === 'time_desc') {
    // Sort by time: latest first (season -> episode -> position, descending)
    sort = [
      { season: { order: 'desc' as estypes.SortOrder } },
      { episode: { order: 'desc' as estypes.SortOrder } },
      { position: { order: 'desc' as estypes.SortOrder } },
    ];
  } else if (!request.length_sort_order || request.length_sort_order === 'none') {
    // When browsing media without query and no length filter, sort by length score (25-30 chars prioritized)
    // Otherwise for match_all with min_length filter, sort by contentLength ascending
    if (isMatchAll && useLengthScoring) {
      sort = [{ _score: { order: 'desc' } }, { contentLength: { order: 'asc' } }];
    } else if (isMatchAll) {
      sort = [{ contentLength: { order: 'asc' } }];
    } else {
      sort = [{ _score: { order: 'desc' } }, { contentLength: { order: 'asc' } }];
    }
  } else {
    sort = [{ contentLength: { order: request.length_sort_order as estypes.SortOrder } }];
  }

  return { sort, randomScoreQuery };
};

const buildTextSearchQuery = (
  query: string,
  exactMatch: boolean,
  hasLengthConstraints: boolean,
): estypes.QueryDslQueryContainer => {
  const baseQuery = buildMultiLanguageQuery(query, exactMatch);

  if (!hasLengthConstraints) {
    return {
      function_score: {
        query: baseQuery,
        functions: buildImprovedLengthTiers(),
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
    const gaussianScore = maxScore * Math.exp(-0.5 * Math.pow((length - mean) / stddev, 2));
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

const buildMediaFilter = (media: QuerySegmentsRequest['media']): estypes.QueryDslQueryContainer => {
  if (!media) return { match_all: {} };

  const mediaQueries: estypes.QueryDslQueryContainer[] = media.flatMap((mediaFilter) => {
    if (!mediaFilter.seasons) {
      return {
        bool: {
          must: [{ term: { mediaId: { value: mediaFilter.media_id } } }],
        },
      };
    }

    return mediaFilter.seasons.flatMap((season) => {
      if (!season.episodes) {
        return {
          bool: {
            must: [
              { term: { mediaId: { value: mediaFilter.media_id } } },
              { term: { season: { value: season.season } } },
            ],
          },
        };
      }

      return season.episodes.map((episode) => ({
        bool: {
          must: [
            { term: { mediaId: { value: mediaFilter.media_id } } },
            { term: { season: { value: season.season } } },
            { term: { episode: { value: episode } } },
          ],
        },
      }));
    });
  });

  return { bool: { should: mediaQueries } };
};
