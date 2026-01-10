import { Client } from '@elastic/elasticsearch';
import {
  FieldValue,
  MsearchRequestItem,
  MsearchResponse,
  QueryDslOperator,
  QueryDslQueryContainer,
  SearchResponse,
  SearchResponseBody,
  SearchTotalHits,
  Sort,
  SortOrder,
} from '@elastic/elasticsearch/lib/api/types';
import { QueryMediaInfoResponse } from '../models/external/queryMediaInfoResponse';
import {
  QuerySegmentsResponse,
  SearchAnimeSentencesSegment,
  SearchAnimeSentencesStatistics,
} from '../models/external/querySegmentsResponse';
import { queryMediaInfo } from './database_queries';
import { getBaseUrlMedia, notEmpty } from '../utils/utils';
import { QueryWordsMatchedResponse, WordMatch, WordMatchMediaInfo } from '../models/external/queryWordsMatchedResponse';
import { logger } from '../utils/log';
import { QuerySegmentsRequest } from '../models/external/querySegmentsRequest';
import { QuerySurroundingSegmentsRequest } from '../models/external/querySurroundingSegmentsRequest';
import { QuerySurroundingSegmentsResponse } from '../models/external/querySurroundingSegmentsResponse';

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
    username: 'elastic',
    password: process.env.ELASTICSEARCH_PASSWORD || '',
  },
});

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

export const querySegments = async (request: QuerySegmentsRequest): Promise<QuerySegmentsResponse> => {
  if (request.min_length !== undefined && request.max_length !== undefined && request.min_length > request.max_length) {
    throw new Error('min_length cannot be greater than max_length');
  }

  const must: QueryDslQueryContainer[] = [];

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

  // Create filters for statistics (without media filter) - used for sidebar
  // This shows all titles matching the query + category filter
  const { filter: filterForStatistics, must_not: must_notForStatistics } = buildCommonFilters(request);
  // Remove anime_id/media filter from statistics filter (for sidebar)
  const filterForStatisticsWithoutMedia = filterForStatistics.filter(
    (f) => !('term' in f && f.term && 'media_id' in f.term)
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
          content_english: {
            matched_fields: ['content_english', 'content_english.exact'],
            type: 'fvh',
          },
          content_spanish: {
            matched_fields: ['content_spanish', 'content_spanish.exact'],
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
                field: 'media_id',
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

  // Create filters for category statistics (with media filter, without category filter) - used for top tabs
  // This shows categories for the query + media filter
  const { filter: filterForCategoryStats, must_not: must_notForCategoryStats } = buildCommonFilters({
    ...request,
    category: undefined, // Remove category filter for category statistics
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
                field: 'media_id',
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
          content_english: {
            matched_fields: ['content_english', 'content_english.exact'],
            type: 'fvh',
          },
          content_spanish: {
            matched_fields: ['content_spanish', 'content_spanish.exact'],
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
            field: 'media_id',
            size: 10000,
          },
        },
      },
    });

    const mediaInfo = queryMediaInfo(0, 10000000);

  return buildSearchAnimeSentencesResponse(
    await esResponse,
    await mediaInfo,
    await esNoHitsNoFiltersResponse,
    await esCategoryStatsResponse,
    request,
  );
};

export const queryWordsMatched = async (words: string[], exact_match: boolean): Promise<QueryWordsMatchedResponse> => {
  const searches: MsearchRequestItem[] = words
    .map((word) => {
      return [
        {},
        {
          size: 0,
          query: buildMultiLanguageQuery(word, exact_match),
          aggs: {
            group_by_media_id: {
              terms: {
                field: 'media_id',
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

  const mediaInfo = await queryMediaInfo(0, 10000000);
  return buildQueryWordsMatchedResponse(words, esResponse, mediaInfo);
};

export const querySurroundingSegments = async (
  request: QuerySurroundingSegmentsRequest,
): Promise<QuerySurroundingSegmentsResponse> => {
  const contextSearches: MsearchRequestItem[] = [
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

    const mediaInfo = await queryMediaInfo(0, 10000000);

    let previousSegments: SearchAnimeSentencesSegment[] = [];
    let nextSegments: SearchAnimeSentencesSegment[] = [];
    if (esResponse.responses[0].status) {
      previousSegments = buildSearchAnimeSentencesSegments(esResponse.responses[0] as SearchResponseBody, mediaInfo);
    }

    if (esResponse.responses[1].status) {
      nextSegments = buildSearchAnimeSentencesSegments(esResponse.responses[1] as SearchResponseBody, mediaInfo);
    }
  const sortedSegments = [...previousSegments, ...nextSegments].sort(
    (a, b) => a.segment_info.position - b.segment_info.position,
  );

  return {
    sentences: sortedSegments,
  };
};

const buildSearchAnimeSentencesResponse = (
  esResponse: SearchResponse,
  mediaInfoResponse: QueryMediaInfoResponse,
  esNoHitsNoFiltersResponse: SearchResponse,
  esCategoryStatsResponse: SearchResponse,
  request: QuerySegmentsRequest,
): QuerySegmentsResponse => {
  const sentences: SearchAnimeSentencesSegment[] = buildSearchAnimeSentencesSegments(esResponse, mediaInfoResponse);

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
  const buildStatisticsFromAggs = (aggResponse: SearchResponse): SearchAnimeSentencesStatistics[] => {
    if (!aggResponse.aggregations || !('group_by_category' in aggResponse.aggregations)) {
      return [];
    }
    // @ts-expect-error -- elasticsearch aggregation type
    return aggResponse.aggregations['group_by_category'].buckets.flatMap((categoryBucket) => {
      return categoryBucket.group_by_media_id.buckets
        .map((mediaBucket: { [x: string]: any }) => {
          const mediaInfo = mediaInfoResponse.results[Number(mediaBucket['key'])];
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
            anime_id: mediaBucket['key'],
            category: mediaInfo.category,
            name_anime_romaji: mediaInfo.romaji_name,
            name_anime_en: mediaInfo.english_name,
            name_anime_jp: mediaInfo.japanese_name,
            amount_sentences_found: mediaBucket['doc_count'],
            season_with_episode_hits: seasonsWithResults,
          };
        })
        .filter(notEmpty);
    });
  };

  // Build statistics from esNoHitsNoFiltersResponse (filtered by category, not by media) - for sidebar
  let statistics: SearchAnimeSentencesStatistics[] = buildStatisticsFromAggs(esNoHitsNoFiltersResponse);

  let cursor: FieldValue[] | undefined = undefined;
  if (esResponse.hits.hits.length >= 1) {
    cursor = esResponse.hits.hits[esResponse.hits.hits.length - 1]['sort'];
  }

  if (!request?.extra) {
    return {
      statistics: [],
      categoryStatistics: [],
      sentences,
      cursor,
    };
  } else {
    return {
      statistics: statistics,
      categoryStatistics: categoryStatistics,
      sentences,
      cursor,
    };
  }
};

const buildSearchAnimeSentencesSegments = (
  esResponse: SearchResponse,
  mediaInfoResponse: QueryMediaInfoResponse,
): SearchAnimeSentencesSegment[] => {
  return esResponse.hits.hits
    .map((hit) => {
      const data: any = hit['_source'];
      const highlight: any = hit['highlight'] || {};
      const mediaInfo = mediaInfoResponse.results[Number(data['media_id'])] || {};
      const seriesNamePath = mediaInfo['folder_media_name'];
      const seasonNumberPath = `S${data['season'].toString().padStart(2, '0')}`;
      const episodeNumberPath = `E${data['episode'].toString().padStart(2, '0')}`;

      const content_jp_highlight = 'content' in highlight ? highlight['content'][0] : '';
      const content_en_highlight = 'content_english' in highlight ? highlight['content_english'][0] : '';
      const content_es_highlight = 'content_spanish' in highlight ? highlight['content_spanish'][0] : '';

      if (!mediaInfo || !Object.keys(mediaInfo).length) {
        logger.error({ mediaId: data['media_id'] }, 'Media Info not found');
        return;
      }
      const location_media = mediaInfo.category == 1 ? 'anime' : mediaInfo.category == 3 ? 'jdrama' : 'audiobook';
      const coverPath = data['path_image']
        ? [
            getBaseUrlMedia(),
            location_media,
            seriesNamePath,
            seasonNumberPath,
            episodeNumberPath,
            data['path_image'],
          ].join('/')
        : mediaInfo.cover || '';

      return {
        basic_info: {
          id_anime: data['media_id'],
          name_anime_romaji: mediaInfo.romaji_name,
          name_anime_en: mediaInfo.english_name,
          name_anime_jp: mediaInfo.japanese_name,
          cover: mediaInfo.cover,
          banner: mediaInfo.banner,
          episode: data['episode'],
          season: data['season'],
          category: mediaInfo.category,
        },
        segment_info: {
          status: data['status'],
          uuid: data['uuid'],
          position: data['position'],
          start_time: data['start_time'],
          end_time: data['end_time'],
          content_jp: data['content'],
          content_jp_highlight,
          content_en: data['content_english'],
          content_en_highlight,
          content_en_mt: data['content_english_mt'],
          content_es: data['content_spanish'],
          content_es_highlight,
          content_es_mt: data['content_spanish_mt'],
          is_nsfw: data['is_nsfw'],
          actor_ja: data['actor_ja'],
          actor_en: data['actor_en'],
          actor_es: data['actor_es'],
        },
        media_info: {
          path_image: coverPath,
          path_audio: [
            getBaseUrlMedia(),
            location_media,
            seriesNamePath,
            seasonNumberPath,
            episodeNumberPath,
            data['path_audio'],
          ].join('/'),
          path_video: [
            getBaseUrlMedia(),
            location_media,
            seriesNamePath,
            seasonNumberPath,
            episodeNumberPath,
            `${data['position']}.mp4`,
          ].join('/'),
        },
      };
    })
    .filter(notEmpty);
};

const buildQueryWordsMatchedResponse = (
  words: string[],
  esResponse: MsearchResponse,
  mediaInfoResponse: QueryMediaInfoResponse,
): QueryWordsMatchedResponse => {
  // Elasticsearch's responses are returned in the exact same order as the words array, so we can iterate them side by side
  const results: WordMatch[] = [];

  for (const [word, response] of words.map((word, i): [string, SearchResponseBody] => [
    word,
    esResponse.responses[i] as SearchResponseBody,
  ])) {
    let is_match = false;
    let total_matches = 0;

    if (response.hits !== undefined && response.hits.total !== undefined) {
      is_match = (response.hits.total as SearchTotalHits).value > 0;
      total_matches = (response.hits.total as SearchTotalHits).value;
    }

    let media: WordMatchMediaInfo[] = [];
    if (response.aggregations && 'group_by_media_id' in response.aggregations) {
      // @ts-expect-error -- elasticsearch aggregation type
      media = response.aggregations['group_by_media_id'].buckets.map((bucket: any): WordMatchMediaInfo => {
        const mediaInfo = mediaInfoResponse.results[Number(bucket['key'])];

        return {
          media_id: mediaInfo['media_id'],
          english_name: mediaInfo['english_name'],
          japanese_name: mediaInfo['japanese_name'],
          romaji_name: mediaInfo['romaji_name'],
          matches: bucket['doc_count'],
        };
      });
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

const buildMultiLanguageQuery = (query: string, exact_match: boolean): QueryDslQueryContainer => {
  const queryText = exact_match ? `"${query}"` : query;
  const detectedScript = detectInputScript(query);
  const boosts = getScriptBoosts(detectedScript);

  const japaneseQuery: QueryDslQueryContainer = {
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

  const languageQueries: QueryDslQueryContainer[] = [japaneseQuery];

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
            fields: [`content_spanish.exact^${boosts.spanish}`],
          },
        },
        {
          multi_match: {
            query: query,
            fields: [`content_english.exact^${boosts.english}`],
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
            fields: [`content_spanish^${boosts.spanish}`, 'content_spanish.exact^1'],
            default_operator: 'AND' as QueryDslOperator,
            quote_field_suffix: '.exact',
          },
        },
        {
          query_string: {
            query,
            analyze_wildcard: true,
            allow_leading_wildcard: false,
            fuzzy_transpositions: false,
            fields: [`content_english^${boosts.english}`, 'content_english.exact^1'],
            default_operator: 'AND' as QueryDslOperator,
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
  rangeQuery: QueryDslQueryContainer,
): QueryDslQueryContainer => {
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
): { filter: QueryDslQueryContainer[]; must_not: QueryDslQueryContainer[] } => {
  const filter: QueryDslQueryContainer[] = [];
  const must_not: QueryDslQueryContainer[] = [];

  filter.push({ terms: { status: request.status } });

  if (request.min_length !== undefined || request.max_length !== undefined) {
    const rangeFilter: { gte?: number; lte?: number } = {};
    if (request.min_length !== undefined) rangeFilter.gte = request.min_length;
    if (request.max_length !== undefined) rangeFilter.lte = request.max_length;
    filter.push({ range: { content_length: rangeFilter } });
  }

  if (request.anime_id) {
    filter.push({ term: { media_id: request.anime_id } });
  }

  if (request.excluded_anime_ids && request.excluded_anime_ids.length > 0) {
    must_not.push({ terms: { media_id: request.excluded_anime_ids } });
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
): { sort: Sort; randomScoreQuery: QueryDslQueryContainer | null } => {
  let sort: Sort = [];
  let randomScoreQuery: QueryDslQueryContainer | null = null;

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
    sort = [{ _score: { order: 'desc' } }, { content_length: { order: 'asc' } }];
  } else if (!request.length_sort_order || request.length_sort_order === 'none') {
    // When browsing media without query and no length filter, sort by length score (25-30 chars prioritized)
    // Otherwise for match_all with min_length filter, sort by content_length ascending
    if (isMatchAll && useLengthScoring) {
      sort = [{ _score: { order: 'desc' } }, { content_length: { order: 'asc' } }];
    } else if (isMatchAll) {
      sort = [{ content_length: { order: 'asc' } }];
    } else {
      sort = [{ _score: { order: 'desc' } }, { content_length: { order: 'asc' } }];
    }
  } else {
    sort = [{ content_length: { order: request.length_sort_order as SortOrder } }];
  }

  return { sort, randomScoreQuery };
};

const buildTextSearchQuery = (
  query: string,
  exactMatch: boolean,
  hasLengthConstraints: boolean,
): QueryDslQueryContainer => {
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
      filter: { range: { content_length: { gte: length, lt: length + 1 } } },
      weight: score,
    });
  }

  buckets.push({
    filter: { range: { content_length: { gte: 80 } } },
    weight: minScore,
  });

  return buckets;
}

const buildMediaFilter = (media: QuerySegmentsRequest['media']): QueryDslQueryContainer => {
  if (!media) return { match_all: {} };

  const mediaQueries: QueryDslQueryContainer[] = media.flatMap((mediaFilter) => {
    if (!mediaFilter.seasons) {
      return {
        bool: {
          must: [{ term: { media_id: { value: mediaFilter.media_id } } }],
        },
      };
    }

    return mediaFilter.seasons.flatMap((season) => {
      if (!season.episodes) {
        return {
          bool: {
            must: [
              { term: { media_id: { value: mediaFilter.media_id } } },
              { term: { season: { value: season.season } } },
            ],
          },
        };
      }

      return season.episodes.map((episode) => ({
        bool: {
          must: [
            { term: { media_id: { value: mediaFilter.media_id } } },
            { term: { season: { value: season.season } } },
            { term: { episode: { value: episode } } },
          ],
        },
      }));
    });
  });

  return { bool: { should: mediaQueries } };
};
