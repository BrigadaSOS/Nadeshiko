import { describe, it, expect } from 'vitest';
import { SegmentQuery } from '@app/services/search/segmentDocument/SegmentQuery';
import { excludedSearchLanguages } from '@lib/searchLanguages';
import type { SearchFiltersOutput } from 'generated/outputTypes';

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
