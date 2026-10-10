import { afterEach, describe, it, expect, vi } from 'vitest';
import { SegmentQuery } from '@app/services/search/segmentDocument/SegmentQuery';
import { excludedSearchLanguages } from '@lib/searchLanguages';
import type { SearchFiltersOutput, SearchSortOutput } from 'generated/outputTypes';

const baseFilters = { status: ['ACTIVE'], category: ['ANIME'] } as unknown as SearchFiltersOutput;

/** Field names referenced anywhere inside the built query, boosts stripped. */
function queriedFields(query: unknown): string[] {
  const fields = new Set<string>();

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== 'object') return;

    for (const [key, value] of Object.entries(node)) {
      if (key === 'fields' && Array.isArray(value)) {
        for (const field of value) fields.add(String(field).split('^')[0]);
      } else if (key === 'match_phrase' && value && typeof value === 'object') {
        for (const field of Object.keys(value)) fields.add(field);
      } else {
        walk(value);
      }
    }
  };

  walk(query);
  return [...fields];
}

function fieldsFor(languages: SearchFiltersOutput['languages'], exactMatch = false): string[] {
  const filters = { ...baseFilters, languages } as SearchFiltersOutput;
  const { must } = SegmentQuery.buildSearchMust(
    { query: { search: 'hello', exactMatch }, filters } as never,
    'strict',
    excludedSearchLanguages(languages),
  );
  return queriedFields(must);
}

const hasEnglish = (fields: string[]) => fields.some((field) => field.startsWith('textEn'));
const hasSpanish = (fields: string[]) => fields.some((field) => field.startsWith('textEs'));

describe('SegmentQuery.buildMultiLanguage language exclusion', () => {
  it('matches Japanese, English and Spanish when no language filter is set', () => {
    const fields = fieldsFor(undefined);
    expect(fields.some((field) => field.startsWith('textJa'))).toBe(true);
    expect(hasEnglish(fields)).toBe(true);
    expect(hasSpanish(fields)).toBe(true);
  });

  it('drops Spanish from matching when only English is included', () => {
    const fields = fieldsFor(['EN']);
    expect(hasEnglish(fields)).toBe(true);
    expect(hasSpanish(fields)).toBe(false);
  });

  it('drops English from matching when only Spanish is included', () => {
    const fields = fieldsFor(['ES']);
    expect(hasSpanish(fields)).toBe(true);
    expect(hasEnglish(fields)).toBe(false);
  });

  it('matches Japanese only when the include list is empty', () => {
    const fields = fieldsFor([]);
    expect(fields.some((field) => field.startsWith('textJa'))).toBe(true);
    expect(hasEnglish(fields)).toBe(false);
    expect(hasSpanish(fields)).toBe(false);
  });

  it('honours the legacy exclude form', () => {
    const fields = fieldsFor({ exclude: ['en'] });
    expect(hasEnglish(fields)).toBe(false);
    expect(hasSpanish(fields)).toBe(true);
  });

  it('applies the exclusion to exact-match queries too', () => {
    const fields = fieldsFor(['EN'], true);
    expect(hasEnglish(fields)).toBe(true);
    expect(hasSpanish(fields)).toBe(false);
  });
});

describe('SegmentQuery.buildSortAndRandomScore', () => {
  const tieBreakers = [
    { mediaId: { order: 'asc', unmapped_type: 'integer' } },
    { episode: { order: 'asc', unmapped_type: 'integer' } },
    { position: { order: 'asc', unmapped_type: 'integer' } },
  ];
  const lengthAscending = [{ characterCount: { order: 'asc', unmapped_type: 'short' } }, ...tieBreakers];
  const scoreThenLength = [{ _score: { order: 'desc' } }, ...lengthAscending];

  const scenarios: [string, boolean, SearchFiltersOutput['segmentLengthChars'], unknown[], string][] = [
    ['match-all without length bounds', true, undefined, scoreThenLength, 'replace'],
    ['match-all with minimum length', true, { min: 10 }, lengthAscending, 'replace'],
    ['match-all with maximum length only', true, { max: 50 }, scoreThenLength, 'replace'],
    ['text query without length bounds', false, undefined, scoreThenLength, 'multiply'],
    ['text query with minimum length', false, { min: 10 }, scoreThenLength, 'multiply'],
    ['text query with maximum length only', false, { max: 50 }, scoreThenLength, 'multiply'],
  ];
  const modes: [string, SearchSortOutput | undefined, unknown[] | undefined, boolean][] = [
    ['default', undefined, undefined, false],
    ['relevance', { mode: 'RELEVANCE' }, undefined, false],
    ['ascending length', { mode: 'ASC' }, lengthAscending, false],
    [
      'descending length',
      { mode: 'DESC' },
      [{ characterCount: { order: 'desc', unmapped_type: 'short' } }, ...tieBreakers],
      false,
    ],
    [
      'ascending time',
      { mode: 'TIME_ASC' },
      [
        { episode: { order: 'asc' } },
        { position: { order: 'asc' } },
        { mediaId: { order: 'asc', unmapped_type: 'integer' } },
      ],
      false,
    ],
    [
      'descending time',
      { mode: 'TIME_DESC' },
      [
        { episode: { order: 'desc' } },
        { position: { order: 'desc' } },
        { mediaId: { order: 'asc', unmapped_type: 'integer' } },
      ],
      false,
    ],
    ['seeded random', { mode: 'RANDOM', seed: 42 }, scoreThenLength, true],
  ];

  afterEach(() => vi.restoreAllMocks());

  describe.each(scenarios)('%s', (_name, isMatchAll, segmentLengthChars, relevanceSort, boostMode) => {
    it.each(modes)('%s', (_mode, sort, expectedSort, random) => {
      const result = SegmentQuery.buildSortAndRandomScore({ sort }, { ...baseFilters, segmentLengthChars }, isMatchAll);

      expect(result).toEqual({
        sort: expectedSort ?? relevanceSort,
        randomScoreQuery: random
          ? { function_score: { functions: [{ random_score: { field: '_seq_no', seed: 42 } }], boost_mode: boostMode } }
          : null,
      });
    });
  });

  it('preserves an explicit zero random seed', () => {
    expect(SegmentQuery.buildSortAndRandomScore({ sort: { mode: 'RANDOM', seed: 0 } }, baseFilters, false)).toEqual({
      sort: scoreThenLength,
      randomScoreQuery: {
        function_score: { functions: [{ random_score: { field: '_seq_no', seed: 0 } }], boost_mode: 'multiply' },
      },
    });
  });

  it.each([
    ['2024-01-01T00:00:00.000Z', 19723],
    ['2024-01-01T23:59:59.999Z', 19723],
    ['2024-01-02T00:00:00.000Z', 19724],
  ])('uses the UTC day as the implicit random seed at %s', (now, seed) => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(now));

    expect(SegmentQuery.buildSortAndRandomScore({ sort: { mode: 'RANDOM' } }, baseFilters, true)).toEqual({
      sort: scoreThenLength,
      randomScoreQuery: {
        function_score: { functions: [{ random_score: { field: '_seq_no', seed } }], boost_mode: 'replace' },
      },
    });
  });
});

describe('SegmentQuery.buildSearchStatsCacheKey', () => {
  const request = (languages: SearchFiltersOutput['languages']) => ({
    query: { search: 'hello', exactMatch: false },
    filters: { ...baseFilters, languages } as SearchFiltersOutput,
  });

  it('distinguishes requests that differ only by language filter', () => {
    const all = SegmentQuery.buildSearchStatsCacheKey(request(undefined), 'strict');
    const englishOnly = SegmentQuery.buildSearchStatsCacheKey(request(['EN']), 'strict');
    const spanishOnly = SegmentQuery.buildSearchStatsCacheKey(request(['ES']), 'strict');

    expect(new Set([all, englishOnly, spanishOnly]).size).toBe(3);
  });

  it('shares a key between equivalent legacy and array forms', () => {
    expect(SegmentQuery.buildSearchStatsCacheKey(request({ exclude: ['es'] }), 'strict')).toBe(
      SegmentQuery.buildSearchStatsCacheKey(request(['EN']), 'strict'),
    );
  });
});
