/** Build language-aware queries with global leading-`-` exclusions, kanji matching that avoids kana homophones, and
 * media weights that affect `_score` only. */

import type { estypes } from '@elastic/elasticsearch';
import { excludedSearchLanguages, type SearchLanguage } from '@lib/searchLanguages';
import type { SearchRequestOutput, SearchFiltersOutput } from 'generated/outputTypes';
import type { ResolvedSearchFilters } from '@app/controllers/searchFilters';
import { buildCommonFilters, expandContentRatingTerms } from './filterRegistry';
import { splitNegatedTerms } from './queryNegation';

enum InputScript {
  KANJI = 'kanji',
  KATAKANA = 'katakana',
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

export type QueryParserMode = 'strict' | 'safe';

const TRANSLATION_FIELDS = [
  ['ES', 'textEs', 'textEs.exact', 'spanish'],
  ['EN', 'textEn', 'textEn.exact', 'english'],
] as const;

/** Use a small multiplicative preferred-title weight so it can break near ties while report penalties still demote a
 * reported title. */
const PREFERRED_MEDIA_SCORE_WEIGHT = 1.15;

export class SegmentQuery {
  static buildSearchMust(
    request: { query?: SearchRequestOutput['query']; filters: SearchFiltersOutput },
    parserMode: QueryParserMode,
    excludeLanguages?: readonly SearchLanguage[],
  ): { must: estypes.QueryDslQueryContainer[]; isMatchAll: boolean; hasQuery: boolean } {
    const must: estypes.QueryDslQueryContainer[] = [];
    const searchTerm = request.query?.search;
    const isMatchAll = !searchTerm;
    const hasQuery = !!searchTerm;
    const hasLengthConstraints =
      request.filters?.segmentLengthChars?.min !== undefined || request.filters?.segmentLengthChars?.max !== undefined;

    if (isMatchAll) {
      if (!hasLengthConstraints) {
        must.push({
          function_score: {
            query: { match_all: {} },
            functions: [{ gauss: { characterCount: { origin: 27, scale: 6, decay: 0.5 } } }],
            score_mode: 'sum',
            boost_mode: 'replace',
          },
        });
      } else {
        must.push({ match_all: {} });
      }
    } else if (searchTerm) {
      const exactMatch = Boolean(request.query?.exactMatch);
      const { positive, negatives } = splitNegatedTerms(searchTerm, exactMatch);

      // Exclusions go in first: buildSortAndRandomScore's caller pops the *last*
      // `must` entry to wrap it in a random_score, and that has to be the text query.
      if (negatives.length > 0) {
        must.push({
          bool: {
            must_not: negatives.map((term) =>
              SegmentQuery.buildMultiLanguage(term, false, parserMode, excludeLanguages),
            ),
          },
        });
      }

      must.push(SegmentQuery.buildTextSearch(positive, exactMatch, hasLengthConstraints, parserMode, excludeLanguages));
    }

    return { must, isMatchAll, hasQuery };
  }

  /** Wrap the assembled query once so every scoring branch gets title weights; group demotions by tier and leave
   * explicit non-score sorts unchanged. */
  static applyMediaScoreWeights(
    query: estypes.QueryDslQueryContainer,
    weights: {
      demoted?: ReadonlyMap<number, number>;
      preferred?: ReadonlySet<number>;
    },
  ): estypes.QueryDslQueryContainer {
    const functions: estypes.QueryDslFunctionScoreContainer[] = [];

    // Bounded by the number of titles in the catalogue, so far below
    // `index.max_terms_count` (65,536) that no chunking is needed.
    for (const [weight, mediaIds] of groupMediaIdsByWeight(weights.demoted)) {
      functions.push({ filter: { terms: { mediaId: mediaIds } }, weight });
    }

    if (weights.preferred?.size) {
      functions.push({
        filter: { terms: { mediaId: [...weights.preferred] } },
        weight: PREFERRED_MEDIA_SCORE_WEIGHT,
      });
    }

    if (functions.length === 0) return query;

    // A preferred reported title gets the product of weights: softened, never rescued, because every demotion remains
    // below the preferred boost.
    return { function_score: { query, functions, score_mode: 'multiply', boost_mode: 'multiply' } };
  }

  /** @see buildCommonFilters in ./filterRegistry -- kept here so call sites stay put. */
  static buildCommonFilters(filters: ResolvedSearchFilters<SearchFiltersOutput>): {
    filter: estypes.QueryDslQueryContainer[];
    must_not: estypes.QueryDslQueryContainer[];
  } {
    return buildCommonFilters(filters);
  }

  static buildSortAndRandomScore(
    request: Pick<SearchRequestOutput, 'sort'>,
    filters: SearchFiltersOutput,
    isMatchAll: boolean,
  ): { sort: estypes.Sort; randomScoreQuery: estypes.QueryDslQueryContainer | null } {
    let sort: estypes.Sort = [];
    let randomScoreQuery: estypes.QueryDslQueryContainer | null = null;

    const useLengthScoring = filters.segmentLengthChars?.min === undefined;
    const sortMode = request.sort?.mode?.toLowerCase();

    if (sortMode === 'random') {
      const seed = request.sort?.seed ?? Math.floor(Date.now() / (1000 * 60 * 60 * 24));
      randomScoreQuery = {
        function_score: {
          functions: [{ random_score: { field: '_seq_no', seed } }],
          boost_mode: isMatchAll ? 'replace' : 'multiply',
        },
      };
      sort = [{ _score: { order: 'desc' } }, { characterCount: { order: 'asc', unmapped_type: 'short' } }];
    } else if (sortMode === 'time_asc') {
      sort = [{ episode: { order: 'asc' as estypes.SortOrder } }, { position: { order: 'asc' as estypes.SortOrder } }];
    } else if (sortMode === 'time_desc') {
      sort = [
        { episode: { order: 'desc' as estypes.SortOrder } },
        { position: { order: 'desc' as estypes.SortOrder } },
      ];
    } else if (!sortMode || sortMode === 'relevance') {
      if (isMatchAll && !useLengthScoring) {
        sort = [{ characterCount: { order: 'asc', unmapped_type: 'short' } }];
      } else {
        sort = [{ _score: { order: 'desc' } }, { characterCount: { order: 'asc', unmapped_type: 'short' } }];
      }
    } else {
      sort = [{ characterCount: { order: sortMode as estypes.SortOrder, unmapped_type: 'short' } }];
    }

    return { sort: SegmentQuery.withStableSortTieBreakers(sort), randomScoreQuery };
  }

  static buildTextSearch(
    query: string,
    exactMatch: boolean,
    hasLengthConstraints: boolean,
    parserMode: QueryParserMode = 'strict',
    excludeLanguages?: readonly SearchLanguage[],
  ): estypes.QueryDslQueryContainer {
    const baseQuery = SegmentQuery.buildMultiLanguage(query, exactMatch, parserMode, excludeLanguages);

    if (!hasLengthConstraints) {
      return {
        function_score: {
          query: baseQuery,
          functions: [{ gauss: { characterCount: { origin: 27, offset: 10, scale: 15, decay: 0.5 } } }],
          score_mode: 'sum',
          boost_mode: 'multiply',
        },
      };
    }

    return baseQuery;
  }

  static buildMultiLanguage(
    query: string,
    exactMatch: boolean,
    parserMode: QueryParserMode = 'strict',
    excludeLanguages?: readonly SearchLanguage[],
  ): estypes.QueryDslQueryContainer {
    const queryText = exactMatch ? `"${query}"` : query;
    const boosts = SegmentQuery.getScriptBoosts(SegmentQuery.detectInputScript(query));
    const excludeSet = new Set<SearchLanguage>(excludeLanguages ?? []);

    const japaneseBaseQuery = SegmentQuery.buildStringQuery({
      query: queryText,
      parserMode,
      analyzeWildcard: true,
      fields: [
        `textJa^${boosts.japanese}`,
        `textJa.baseform^${boosts.japaneseBaseform}`,
        `textJa.normalized^${boosts.japaneseNormalized}`,
      ],
      quoteAnalyzer: 'ja_surface_search_analyzer',
      defaultOperator: 'AND',
    });

    const japaneseQuery: estypes.QueryDslQueryContainer = exactMatch
      ? japaneseBaseQuery
      : {
          bool: {
            must: [japaneseBaseQuery],
            should: [
              {
                match_phrase: {
                  textJa: { query, boost: 10 },
                },
              },
            ],
          },
        };

    const languageQueries: estypes.QueryDslQueryContainer[] = [japaneseQuery];

    if (boosts.japaneseKana > 0) {
      languageQueries.push(
        SegmentQuery.buildStringQuery({
          query: queryText,
          parserMode,
          fields: [`textJa.kana^${boosts.japaneseKana}`],
          analyzer: 'ja_kana_search_analyzer',
          defaultOperator: 'AND',
        }),
      );
    }

    for (const [language, field, exactField, boostKey] of TRANSLATION_FIELDS) {
      if (excludeSet.has(language)) continue;

      const boost = boosts[boostKey];
      if (exactMatch) {
        languageQueries.push({ multi_match: { query, fields: [`${exactField}^${boost}`] } });
      } else {
        const baseQuery = SegmentQuery.buildStringQuery({
          query,
          parserMode,
          analyzeWildcard: true,
          fields: [`${field}^${boost}`, `${exactField}^1`],
          defaultOperator: 'AND',
          quoteFieldSuffix: '.exact',
        });
        languageQueries.push({
          bool: {
            must: [baseQuery],
            should: [{ match_phrase: { [exactField]: { query, boost: 10 } } }],
          },
        });
      }
    }

    return { dis_max: { queries: languageQueries, tie_breaker: 0.1 } };
  }

  static buildUuidContext(
    mediaId: number,
    episode: number,
    rangeQuery: estypes.QueryDslQueryContainer,
    contentRating?: string[],
  ): estypes.QueryDslQueryContainer {
    const filter: estypes.QueryDslQueryContainer[] = [{ term: { mediaId } }, { term: { episode } }, rangeQuery];
    if (contentRating?.length) {
      filter.push({ terms: { contentRating: expandContentRatingTerms(contentRating) } });
    }
    return { bool: { filter } };
  }

  static buildSearchStatsCacheKey(
    request: { query?: { search?: string; exactMatch?: boolean }; filters: SearchFiltersOutput },
    parserMode: QueryParserMode,
  ): string {
    const f = request.filters;
    return JSON.stringify({
      parserMode,
      search: request.query?.search ?? null,
      exactMatch: Boolean(request.query?.exactMatch),
      status: SegmentQuery.normalizeStringArray(f.status),
      category: SegmentQuery.normalizeStringArray(f.category),
      excludedLanguages: excludedSearchLanguages(f.languages),
      contentRating: SegmentQuery.normalizeStringArray(f.contentRating),
      mediaInclude:
        f.media?.include?.map((m) => ({ mediaPublicId: m.mediaPublicId, episodes: m.episodes?.sort() })) ?? null,
      mediaExclude:
        f.media?.exclude?.map((m) => ({ mediaPublicId: m.mediaPublicId, episodes: m.episodes?.sort() })) ?? null,
      segmentLengthChars: f.segmentLengthChars ?? null,
      segmentDurationMs: f.segmentDurationMs ?? null,
    });
  }

  private static detectInputScript(query: string): InputScript {
    if (/[\u4e00-\u9faf]/.test(query)) return InputScript.KANJI;
    if (/[\u3040-\u309f]/.test(query)) return InputScript.KANA;
    if (/[\u30a0-\u30ff]/.test(query)) return InputScript.KATAKANA;
    return InputScript.ROMAJI;
  }

  private static getScriptBoosts(detectedScript: InputScript): ScriptBoostConfig {
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
      [InputScript.KATAKANA]: {
        japanese: 10,
        japaneseBaseform: 5,
        japaneseNormalized: 4,
        japaneseKana: 0,
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

  private static withStableSortTieBreakers(sort: estypes.Sort): estypes.Sort {
    const sortArray = (Array.isArray(sort) ? [...sort] : [sort]) as Record<string, any>[];
    const existingSortFields = new Set(
      sortArray.flatMap((item) => (item && typeof item === 'object' ? Object.keys(item) : [])),
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

  private static normalizeStringArray(values?: readonly string[]): string[] {
    if (!values || values.length === 0) return [];
    return [...new Set(values)].sort();
  }

  private static buildStringQuery({
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
}

/** Group ids by distinct weight and sort each group for stable, comparable emitted queries. */
function groupMediaIdsByWeight(weights: ReadonlyMap<number, number> | undefined): Map<number, number[]> {
  const byWeight = new Map<number, number[]>();
  if (!weights?.size) return byWeight;

  for (const [mediaId, weight] of weights) {
    const bucket = byWeight.get(weight);
    if (bucket) bucket.push(mediaId);
    else byWeight.set(weight, [mediaId]);
  }

  for (const bucket of byWeight.values()) bucket.sort((a, b) => a - b);

  return new Map([...byWeight].sort(([a], [b]) => a - b));
}
