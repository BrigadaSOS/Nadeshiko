import { describe, expect, it } from 'vitest';
import { SegmentQuery, type QueryParserMode } from '@app/services/search/segmentDocument/SegmentQuery';
import { excludedSearchLanguages, type SearchLanguage } from '@lib/searchLanguages';
import type { SearchFiltersOutput } from 'generated/outputTypes';

const scripts = [
  {
    name: 'romaji',
    query: 'school',
    japaneseFields: ['textJa^2', 'textJa.baseform^1', 'textJa.normalized^2'],
    kanaFields: ['textJa.kana^3'],
    spanishField: 'textEs^10',
    englishField: 'textEn^10',
    spanishExactField: 'textEs.exact^10',
    englishExactField: 'textEn.exact^10',
  },
  {
    name: 'kanji',
    query: '学校',
    japaneseFields: ['textJa^10', 'textJa.baseform^5', 'textJa.normalized^4'],
    kanaFields: [],
    spanishField: 'textEs^1',
    englishField: 'textEn^1',
    spanishExactField: 'textEs.exact^1',
    englishExactField: 'textEn.exact^1',
  },
  {
    name: 'kana',
    query: 'たべる',
    japaneseFields: ['textJa^10', 'textJa.baseform^5', 'textJa.normalized^4'],
    kanaFields: ['textJa.kana^3'],
    spanishField: 'textEs^1',
    englishField: 'textEn^1',
    spanishExactField: 'textEs.exact^1',
    englishExactField: 'textEn.exact^1',
  },
  {
    name: 'katakana',
    query: 'アイメイ',
    japaneseFields: ['textJa^10', 'textJa.baseform^5', 'textJa.normalized^4'],
    kanaFields: [],
    spanishField: 'textEs^1',
    englishField: 'textEn^1',
    spanishExactField: 'textEs.exact^1',
    englishExactField: 'textEn.exact^1',
  },
];

const parsers: {
  mode: QueryParserMode;
  key: string;
  options: Record<string, unknown>;
  japaneseOptions: Record<string, unknown>;
}[] = [
  {
    mode: 'strict',
    key: 'query_string',
    options: { allow_leading_wildcard: false, fuzzy_transpositions: false },
    japaneseOptions: { quote_analyzer: 'ja_surface_search_analyzer' },
  },
  { mode: 'safe', key: 'simple_query_string', options: {}, japaneseOptions: {} },
];

const languages: {
  name: string;
  filter: SearchFiltersOutput['languages'];
  translations: SearchLanguage[];
}[] = [
  { name: 'all languages', filter: undefined, translations: ['ES', 'EN'] },
  { name: 'English only', filter: ['EN'], translations: ['EN'] },
  { name: 'Spanish only', filter: ['ES'], translations: ['ES'] },
  { name: 'Japanese only', filter: [], translations: [] },
];

const wireValue = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe.each(scripts)('buildMultiLanguage: $name', (script) => {
  describe.each(parsers)('$mode parser', ({ mode, key, options, japaneseOptions }) => {
    describe.each([false, true])('exactMatch=%s', (exactMatch) => {
      it.each(languages)('$name', ({ filter, translations }) => {
        const query = script.query;
        const japaneseBase = {
          [key]: {
            query: exactMatch ? `"${query}"` : query,
            fields: script.japaneseFields,
            analyze_wildcard: true,
            default_operator: 'AND',
            ...options,
            ...japaneseOptions,
          },
        };
        const japanese = exactMatch
          ? japaneseBase
          : {
              bool: {
                must: [japaneseBase],
                should: [{ match_phrase: { textJa: { query, boost: 10 } } }],
              },
            };
        const kana = script.kanaFields.length
          ? [
              {
                [key]: {
                  query: exactMatch ? `"${query}"` : query,
                  fields: script.kanaFields,
                  analyzer: 'ja_kana_search_analyzer',
                  analyze_wildcard: false,
                  default_operator: 'AND',
                  ...options,
                },
              },
            ]
          : [];
        const expectedTranslations = {
          ES: exactMatch
            ? { multi_match: { query, fields: [script.spanishExactField] } }
            : {
                bool: {
                  must: [
                    {
                      [key]: {
                        query,
                        fields: [script.spanishField, 'textEs.exact^1'],
                        analyze_wildcard: true,
                        default_operator: 'AND',
                        quote_field_suffix: '.exact',
                        ...options,
                      },
                    },
                  ],
                  should: [{ match_phrase: { 'textEs.exact': { query, boost: 10 } } }],
                },
              },
          EN: exactMatch
            ? { multi_match: { query, fields: [script.englishExactField] } }
            : {
                bool: {
                  must: [
                    {
                      [key]: {
                        query,
                        fields: [script.englishField, 'textEn.exact^1'],
                        analyze_wildcard: true,
                        default_operator: 'AND',
                        quote_field_suffix: '.exact',
                        ...options,
                      },
                    },
                  ],
                  should: [{ match_phrase: { 'textEn.exact': { query, boost: 10 } } }],
                },
              },
        };

        expect(
          wireValue(SegmentQuery.buildMultiLanguage(query, exactMatch, mode, excludedSearchLanguages(filter))),
        ).toEqual({
          dis_max: {
            queries: [japanese, ...kana, ...translations.map((language) => expectedTranslations[language])],
            tie_breaker: 0.1,
          },
        });
      });
    });
  });
});
