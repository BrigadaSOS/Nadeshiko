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
import { SearchAnimeSentencesRequest } from 'models/controller/SearchAnimeSentencesRequest';
import elasticsearchSchema from '../config/elasticsearch-schema.json';

/**
 * =============================================================================
 * ELASTICSEARCH SEARCH ARCHITECTURE
 * =============================================================================
 *
 * JAPANESE CONTENT FIELDS (3 fields for different matching strategies)
 * -----------------------------------------------------------------------------
 * | Field            | Purpose                    | Example: "食べました"       |
 * |------------------|----------------------------|----------------------------|
 * | content          | Exact text matching        | Tokens: 食べ, ました        |
 * | content.baseform | Dictionary form matching   | Tokens: 食べる, ます        |
 * | content.kana     | Pronunciation/romaji match | Tokens: タベ, マシタ        |
 * -----------------------------------------------------------------------------
 *
 * FIELD SELECTION BY INPUT TYPE
 * -----------------------------------------------------------------------------
 * | Input Type       | Fields (with boosts)                    | Rationale    |
 * |------------------|----------------------------------------|--------------|
 * | Romaji (go)      | EN/ES^10, kana^3, content^2, base^1    | Prefer EN/ES |
 * | Kanji (食べる)    | content^10, baseform^5 (NO kana)       | Exact match  |
 * | Kana (たべる)     | content^10, baseform^5, kana^3         | Standard     |
 * -----------------------------------------------------------------------------
 * Note: Kanji queries exclude kana field to avoid homophone noise
 *
 * SCORING (boost_mode: replace - ignores term frequency)
 * -----------------------------------------------------------------------------
 * Length tiers (highest to lowest priority):
 *   Tier 1: 25-30 chars → score 100 (ideal example sentences)
 *   Tier 2: 30-35 chars → score 90
 *   Tier 3: 20-25 chars → score 80
 *   Tier 4: 35-40 chars → score 70
 *   Tier 5: 10-20 chars → score 60
 *   Tier 6: 40+ chars   → score 50
 *   Tier 7: 7-10 chars  → score 40
 *   Tier 8: <7 chars    → score 10 (penalized)
 *
 * Language selection (dis_max with tie_breaker: 0.3):
 *   - Picks best matching language, 30% contribution from others
 *
 * QUERY SYNTAX (supported via query_string)
 * -----------------------------------------------------------------------------
 * - AND, OR, NOT operators: "cat AND dog", "cat OR dog"
 * - Required/excluded: "+required -excluded"
 * - Phrase search: "exact phrase"
 * - Wildcards: "te*t" (no leading wildcards)
 * =============================================================================
 */

export const client = new Client({
  node: process.env.ELASTICSEARCH_HOST,
  auth: {
    username: 'elastic',
    password: process.env.ELASTICSEARCH_PASSWORD || '',
  },
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
    settings: elasticsearchSchema.settings,
    mappings: elasticsearchSchema.mappings,
  });

  logger.info(`Elasticsearch index '${INDEX_NAME}' created successfully from config/elasticsearch-schema.json`);
}

export const querySegments = async (request: QuerySegmentsRequest): Promise<QuerySegmentsResponse> => {
  const must: QueryDslQueryContainer[] = [];
  const filter: QueryDslQueryContainer[] = [];
  const must_not: QueryDslQueryContainer[] = [];
  
  let sort: Sort = [];

  // Match only by uuid and return 1 result. This takes precedence over other queries
  if (request.uuid) {
    must.push({
      match: {
        uuid: request.uuid,
      },
    });
  }

  // Search by query, optionally filtering by media_id to only return results from an specific anime
  // Validate length range if provided
  if (request.min_length !== undefined && request.max_length !== undefined && request.min_length > request.max_length) {
    throw new Error('min_length cannot be greater than max_length');
  }

  if (request.query && !request.uuid) {
    if (request.length_sort_order && request.length_sort_order.toLowerCase() === 'random') {
      const seed = request.random_seed || undefined;

      must.push({
        function_score: {
          query: {
            bool: {
              should: buildMultiLanguageQuery(request.query, request.exact_match || false),
            },
          },
          functions: [
            {
              random_score: {
                field: '_seq_no',
                seed: seed,
              },
              weight: 1, // Small random factor
            },
            // Length tiers (same as non-random)
            { filter: { range: { content_length: { gte: 25, lt: 30 } } }, weight: 100 },
            { filter: { range: { content_length: { gte: 30, lt: 35 } } }, weight: 90 },
            { filter: { range: { content_length: { gte: 20, lt: 25 } } }, weight: 80 },
            { filter: { range: { content_length: { gte: 35, lt: 40 } } }, weight: 70 },
            { filter: { range: { content_length: { gte: 10, lt: 20 } } }, weight: 60 },
            { filter: { range: { content_length: { gte: 40 } } }, weight: 50 },
            { filter: { range: { content_length: { gte: 7, lt: 10 } } }, weight: 40 },
            { filter: { range: { content_length: { lt: 7 } } }, weight: 10 },
          ],
          score_mode: 'sum', // Add random + length tier
          boost_mode: 'replace',
        },
      });
    } else {
      const baseQuery = {
        bool: {
          should: buildMultiLanguageQuery(request.query, request.exact_match || false),
        },
      };

      // Apply length-based scoring using tiered filters
      // Replaces text relevance entirely - length is the primary ranking factor
      // Tier order: 25-30 > 30-35 > 20-25 > 35-40 > 10-20 > 40+ > 7-10 > <7
      must.push({
        function_score: {
          query: baseQuery,
          functions: [
            // Tier 1: 25-30 chars (ideal example sentences)
            { filter: { range: { content_length: { gte: 25, lt: 30 } } }, weight: 100 },
            // Tier 2: 30-35 chars
            { filter: { range: { content_length: { gte: 30, lt: 35 } } }, weight: 90 },
            // Tier 3: 20-25 chars
            { filter: { range: { content_length: { gte: 20, lt: 25 } } }, weight: 80 },
            // Tier 4: 35-40 chars
            { filter: { range: { content_length: { gte: 35, lt: 40 } } }, weight: 70 },
            // Tier 5: 10-20 chars
            { filter: { range: { content_length: { gte: 10, lt: 20 } } }, weight: 60 },
            // Tier 6: 40+ chars (long sentences)
            { filter: { range: { content_length: { gte: 40 } } }, weight: 50 },
            // Tier 7: 7-10 chars (short)
            { filter: { range: { content_length: { gte: 7, lt: 10 } } }, weight: 40 },
            // Tier 8: <7 chars (penalized)
            { filter: { range: { content_length: { lt: 7 } } }, weight: 10 },
          ],
          score_mode: 'first', // Use first matching filter
          boost_mode: 'replace', // Replace text relevance with length score
        },
      });
    }

    filter.push({
      terms: {
        status: request.status,
      },
    });

    // Add length range filter if specified
    if (request.min_length !== undefined || request.max_length !== undefined) {
      const rangeFilter: any = {};
      if (request.min_length !== undefined) {
        rangeFilter.gte = request.min_length;
      }
      if (request.max_length !== undefined) {
        rangeFilter.lte = request.max_length;
      }
      filter.push({
        range: {
          content_length: rangeFilter,
        },
      });
    }

    if (request.anime_id) {
      filter.push({
        term: {
          media_id: request.anime_id,
        },
      });
    }

    if (request.excluded_anime_ids && request.excluded_anime_ids.length > 0) {
      must_not.push({
        terms: {
          media_id: request.excluded_anime_ids,
        },
      });
    }

    if (request.season) {
      filter.push({
        terms: {
          season: request.season,
        },
      });
    }

    if (request.episode) {
      filter.push({
        terms: {
          episode: request.episode,
        },
      });
    }

    if (request.media) {
      const mediaQueries: QueryDslQueryContainer[] = request.media.flatMap((mediaFilter) => {
        if (!mediaFilter.seasons) {
          return {
            bool: {
              must: [
                {
                  term: {
                    media_id: {
                      value: mediaFilter.media_id,
                    },
                  },
                },
              ],
            },
          };
        }

        return mediaFilter.seasons.flatMap((season) => {
          if (!season.episodes) {
            return {
              bool: {
                must: [
                  {
                    term: {
                      media_id: {
                        value: mediaFilter.media_id,
                      },
                    },
                  },
                  {
                    term: {
                      season: {
                        value: season.season,
                      },
                    },
                  },
                ],
              },
            };
          }

          return season.episodes.flatMap((episode) => {
            return {
              bool: {
                must: [
                  {
                    term: {
                      media_id: {
                        value: mediaFilter.media_id,
                      },
                    },
                  },
                  {
                    term: {
                      season: {
                        value: season.season,
                      },
                    },
                  },
                  {
                    term: {
                      episode: {
                        value: episode,
                      },
                    },
                  },
                ],
              },
            };
          });
        });
      });

      filter.push({
        bool: {
          should: mediaQueries,
        },
      });
    }

    if (request.category && request.category.length > 0) {
      filter.push({
        terms: {
          'Media.category': request.category,
        },
      });
    }

    // Sort is only used when we search by a query. For uuid queries it is not included
    if (!request.length_sort_order || request.length_sort_order === 'none') {
      sort = [{ _score: { order: 'desc' } }, { content_length: { order: 'asc' } }];
    } else if (request.length_sort_order === 'random') {
      // Score is randomized by the random function score, but this is required for the cursor field to appear
      sort = [{ _score: { order: 'desc' } }, { content_length: { order: 'asc' } }];
    } else {
      // Override score order when defining sort order
      sort = [{ content_length: { order: request.length_sort_order as SortOrder } }];
    }
  }

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
        must,
        must_not
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
        must_not
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

  return buildSearchAnimeSentencesResponse(await esResponse, await mediaInfo, await esNoHitsNoFiltersResponse, request);
};

export const queryWordsMatched = async (words: string[], exact_match: boolean): Promise<QueryWordsMatchedResponse> => {
  const searches: MsearchRequestItem[] = words
    .map((word) => {
      return [
        {},
        {
          size: 0,
          query: {
            bool: {
              should: buildMultiLanguageQuery(word, exact_match),
            },
          },
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
  request: QuerySegmentsRequest,
): QuerySegmentsResponse => {
  const sentences: SearchAnimeSentencesSegment[] = buildSearchAnimeSentencesSegments(esResponse, mediaInfoResponse);

  let categoryStatistics = [];
  if (esNoHitsNoFiltersResponse.aggregations && 'group_by_category' in esNoHitsNoFiltersResponse.aggregations) {
    // @ts-ignore
    categoryStatistics = esNoHitsNoFiltersResponse.aggregations['group_by_category'].buckets.map((bucket) => ({
      category: bucket['key'],
      count: bucket['doc_count'],
    }));
  }

  let statistics: SearchAnimeSentencesStatistics[] = [];
  if (esNoHitsNoFiltersResponse.aggregations && 'group_by_category' in esNoHitsNoFiltersResponse.aggregations) {
    // @ts-ignore
    statistics = esNoHitsNoFiltersResponse.aggregations['group_by_category'].buckets.flatMap((categoryBucket) => {
      // @ts-ignore
      return categoryBucket.group_by_media_id.buckets
        .map((mediaBucket: { [x: string]: any }) => {
          const mediaInfo = mediaInfoResponse.results[Number(mediaBucket['key'])];
          if (!mediaInfo || !Object.keys(mediaInfo).length) {
            return undefined;
          }
          // @ts-ignore
          const seasonsWithResults = mediaBucket['group_by_season'].buckets.reduce((seasonsAcc, seasonBucket) => {
            // @ts-ignore
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
  }

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
        logger.error('Media Info not found for anime with id %s', data['media_id']);
        return;
      }
      let location_media = mediaInfo.category == 1 ? 'anime' : mediaInfo.category == 3 ? 'jdrama' : 'audiobook';
      const coverPath = data['path_image']
        ? [getBaseUrlMedia(), location_media, seriesNamePath, seasonNumberPath, episodeNumberPath, data['path_image']].join('/')
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
          path_image: 
           coverPath,
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
      // @ts-ignore
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

/**
 * Builds a multi-language search query that searches Japanese, English, and Spanish content.
 *
 * Uses dis_max to pick the best-matching language instead of adding scores together,
 * which prevents cross-language noise (e.g., an English match boosting a Japanese search).
 *
 * Supported query syntax (query_string):
 * - AND, OR, NOT operators: "cat AND dog", "cat OR dog", "cat NOT dog"
 * - Required/excluded terms: "+required -excluded"
 * - Phrase search: "exact phrase"
 * - Wildcards: "te*t", "test?" (no leading wildcards)
 * - Grouping: "(cat OR dog) AND bird"
 * - Escaping special chars: "1\+1" to search literal "1+1"
 *
 * @param query - The search query text
 * @param exact_match - If true, treats the entire query as a phrase
 * @returns A dis_max query container with language-specific sub-queries
 */
const buildMultiLanguageQuery = (query: string, exact_match: boolean): QueryDslQueryContainer[] => {
  const queryText = exact_match ? `"${query}"` : query;

  // Build Japanese query
  const japaneseQuery: QueryDslQueryContainer = {
    query_string: {
      query: queryText,
      analyze_wildcard: true,
      allow_leading_wildcard: false,
      fuzzy_transpositions: false,
      fields: ['content^10', 'content.readingform^5', 'content.baseform^2'],
      default_operator: 'AND',
      quote_analyzer: 'ja_original_search_analyzer',
    },
  };

  // Build English query
  const englishQuery: QueryDslQueryContainer = {
    query_string: {
      query: queryText,
      analyze_wildcard: true,
      allow_leading_wildcard: false,
      fuzzy_transpositions: false,
      fields: exact_match
        ? ['content_english.exact']
        : ['content_english^2', 'content_english.exact^1'],
      default_operator: 'AND',
      quote_field_suffix: '.exact',
    },
  };

  // Build Spanish query
  const spanishQuery: QueryDslQueryContainer = {
    query_string: {
      query: queryText,
      analyze_wildcard: true,
      allow_leading_wildcard: false,
      fuzzy_transpositions: false,
      fields: exact_match
        ? ['content_spanish.exact']
        : ['content_spanish^2', 'content_spanish.exact^1'],
      default_operator: 'AND',
      quote_field_suffix: '.exact',
    },
  };

  // Use dis_max to pick the best-matching language
  // tie_breaker allows some contribution from other matching languages (0.3 = 30%)
  return [
    {
      dis_max: {
        queries: [japaneseQuery, englishQuery, spanishQuery],
        tie_breaker: 0.3,
      },
    },
  ];
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
