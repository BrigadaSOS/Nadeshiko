/**
 * =============================================================================
 * ELASTICSEARCH SEARCH ARCHITECTURE
 * =============================================================================
 *
 * JAPANESE CONTENT FIELDS (4 fields for different matching strategies)
 * -----------------------------------------------------------------------------
 * | Field               | Purpose                      | Example: "食べました"       |
 * |---------------------|------------------------------|----------------------------|
 * | textJa              | Surface form (exact tokens)  | Tokens: 食べ, ました        |
 * | textJa.baseform     | Dictionary form matching     | Tokens: 食べる              |
 * | textJa.normalized   | Orthographic + conjugation   | Tokens: 食べる, ます        |
 * | textJa.kana         | Pronunciation/reading match  | Tokens: タベ, マシタ        |
 * -----------------------------------------------------------------------------
 *
 * textJa vs textJa.normalized vs textJa.baseform:
 *   - textJa: true surface tokens, no normalization. 食べられない ≠ 食べれなかった
 *   - normalized: sudachi_normalizedform applied. 喰べる = 食べる, で = だろ (same base copula)
 *   - baseform: dictionary form + particles/auxiliaries stripped. 食べられなかった → 食べる
 *
 * ENGLISH/SPANISH FIELDS
 * -----------------------------------------------------------------------------
 * | Field         | Purpose            | Example: "schools"        |
 * |---------------|--------------------|---------------------------|
 * | textEn        | Stemmed matching   | Token: school             |
 * | textEn.exact  | Unstemmed matching | Token: schools            |
 * | textEs        | Stemmed matching   | (spanish stemmer applied) |
 * | textEs.exact  | Unstemmed matching | (lowercase + asciifolding)|
 * -----------------------------------------------------------------------------
 *
 * FIELD SELECTION BY INPUT TYPE (AUTO-DETECTED)
 * -----------------------------------------------------------------------------
 * | Input Type       | Fields (with boosts)                        | Rationale           |
 * |------------------|---------------------------------------------|---------------------|
 * | Romaji (go)      | EN/ES^10, kana^3, textJa^2, norm^2, base^1 | Prefer EN/ES        |
 * | Kanji (食べる)    | textJa^10, baseform^5, norm^4 (NO kana)     | Avoid homophones    |
 * | Kana (たべる)     | textJa^10, baseform^5, norm^4, kana^3       | Standard search     |
 * -----------------------------------------------------------------------------
 *
 * PHRASE BOOSTING
 * -----------------------------------------------------------------------------
 * Non-quoted searches add a match_phrase should clause (boost: 10) on the exact
 * field (textJa for Japanese, textEn.exact/textEs.exact for EN/ES). This ensures
 * sentences with the tokens in order rank much higher than scattered token matches.
 *
 * QUOTED SEARCH ("exact phrase")
 * -----------------------------------------------------------------------------
 * For Japanese: query_string natively handles "quotes" as phrase queries. Since
 * textJa uses surface tokens (no normalization), quoted phrases match only the
 * exact token sequence. The baseform/normalized fields naturally won't match
 * because their indexed tokens differ from the surface-analyzed query tokens.
 *
 * For EN/ES: quoteFieldSuffix '.exact' redirects quoted phrases to the unstemmed
 * .exact sub-field, so "eating" matches only "eating", not "eat"/"eaten".
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

import type { estypes } from '@elastic/elasticsearch';
import type { SearchRequestOutput, SearchFiltersOutput } from 'generated/outputTypes';

export enum InputScript {
  KANJI = 'kanji',
  KANA = 'kana',
  ROMAJI = 'romaji',
}

export interface ScriptBoostConfig {
  japanese: number;
  japaneseBaseform: number;
  japaneseNormalized: number;
  japaneseKana: number;
  english: number;
  spanish: number;
}

export type QueryParserMode = 'strict' | 'safe';

export class SegmentQuery {
  static buildSearchMust(
    request: { query?: SearchRequestOutput['query']; filters: SearchFiltersOutput },
    parserMode: QueryParserMode,
    excludeLanguages?: string[],
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
      must.push(
        SegmentQuery.buildTextSearch(
          searchTerm,
          Boolean(request.query?.exactMatch),
          hasLengthConstraints,
          parserMode,
          excludeLanguages,
        ),
      );
    }

    return { must, isMatchAll, hasQuery };
  }

  static buildCommonFilters(filters: SearchFiltersOutput): {
    filter: estypes.QueryDslQueryContainer[];
    must_not: estypes.QueryDslQueryContainer[];
  } {
    const filter: estypes.QueryDslQueryContainer[] = [];
    const must_not: estypes.QueryDslQueryContainer[] = [];

    filter.push({ terms: { status: filters.status } });

    if (filters.segmentLengthChars?.min !== undefined || filters.segmentLengthChars?.max !== undefined) {
      const rangeFilter: { gte?: number; lte?: number } = {};
      if (filters.segmentLengthChars.min !== undefined) rangeFilter.gte = filters.segmentLengthChars.min;
      if (filters.segmentLengthChars.max !== undefined) rangeFilter.lte = filters.segmentLengthChars.max;
      filter.push({ range: { characterCount: rangeFilter } });
    }

    if (filters.segmentDurationMs?.min !== undefined || filters.segmentDurationMs?.max !== undefined) {
      const rangeFilter: { gte?: number; lte?: number } = {};
      if (filters.segmentDurationMs.min !== undefined) rangeFilter.gte = filters.segmentDurationMs.min;
      if (filters.segmentDurationMs.max !== undefined) rangeFilter.lte = filters.segmentDurationMs.max;
      filter.push({ range: { durationMs: rangeFilter } });
    }

    if (filters.media?.include && filters.media.include.length > 0) {
      filter.push(SegmentQuery.buildMediaFilter(filters.media.include as any));
    }

    if (filters.media?.exclude && filters.media.exclude.length > 0) {
      must_not.push(SegmentQuery.buildMediaFilter(filters.media.exclude as any));
    }

    if (filters.contentRating && filters.contentRating.length > 0) {
      filter.push({ terms: { contentRating: SegmentQuery.expandContentRatingTerms(filters.contentRating) } });
    }

    if (filters.category && filters.category.length > 0) {
      filter.push({ terms: { category: filters.category } });
    }

    return { filter, must_not };
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
      if (isMatchAll && useLengthScoring) {
        sort = [{ _score: { order: 'desc' } }, { characterCount: { order: 'asc', unmapped_type: 'short' } }];
      } else if (isMatchAll) {
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
    excludeLanguages?: string[],
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
    excludeLanguages?: string[],
  ): estypes.QueryDslQueryContainer {
    const queryText = exactMatch ? `"${query}"` : query;
    const boosts = SegmentQuery.getScriptBoosts(SegmentQuery.detectInputScript(query));
    const excludeSet = new Set(excludeLanguages ?? []);

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

    if (exactMatch) {
      if (!excludeSet.has('es')) {
        languageQueries.push({ multi_match: { query, fields: [`textEs.exact^${boosts.spanish}`] } });
      }
      if (!excludeSet.has('en')) {
        languageQueries.push({ multi_match: { query, fields: [`textEn.exact^${boosts.english}`] } });
      }
    } else {
      if (!excludeSet.has('es')) {
        const esBaseQuery = SegmentQuery.buildStringQuery({
          query,
          parserMode,
          analyzeWildcard: true,
          fields: [`textEs^${boosts.spanish}`, 'textEs.exact^1'],
          defaultOperator: 'AND' as estypes.QueryDslOperator,
          quoteFieldSuffix: '.exact',
        });
        languageQueries.push({
          bool: {
            must: [esBaseQuery],
            should: [{ match_phrase: { 'textEs.exact': { query, boost: 10 } } }],
          },
        });
      }
      if (!excludeSet.has('en')) {
        const enBaseQuery = SegmentQuery.buildStringQuery({
          query,
          parserMode,
          analyzeWildcard: true,
          fields: [`textEn^${boosts.english}`, 'textEn.exact^1'],
          defaultOperator: 'AND' as estypes.QueryDslOperator,
          quoteFieldSuffix: '.exact',
        });
        languageQueries.push({
          bool: {
            must: [enBaseQuery],
            should: [{ match_phrase: { 'textEn.exact': { query, boost: 10 } } }],
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
      filter.push({ terms: { contentRating: SegmentQuery.expandContentRatingTerms(contentRating) } });
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
    if (/[\u3040-\u309f]/.test(query) || /[\u30a0-\u30ff]/.test(query)) return InputScript.KANA;
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

  private static expandContentRatingTerms(contentRating: string[]): string[] {
    const values = new Set<string>();
    for (const rating of contentRating) {
      values.add(rating.toUpperCase());
      values.add(rating.toLowerCase());
    }
    return [...values];
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

  private static buildMediaFilter(
    include: Array<{ mediaId: number | string; episodes?: number[] }>,
  ): estypes.QueryDslQueryContainer {
    const mediaQueries: estypes.QueryDslQueryContainer[] = include.flatMap((mediaFilter) => {
      if (!mediaFilter.episodes || mediaFilter.episodes.length === 0) {
        return { bool: { must: [{ term: { mediaId: { value: mediaFilter.mediaId } } }] } };
      }
      return mediaFilter.episodes.map((episode) => ({
        bool: {
          must: [{ term: { mediaId: { value: mediaFilter.mediaId } } }, { term: { episode: { value: episode } } }],
        },
      }));
    });
    return { bool: { should: mediaQueries } };
  }
}
