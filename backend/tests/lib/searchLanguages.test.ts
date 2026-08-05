import { describe, it, expect } from 'vitest';
import { SEARCH_LANGUAGES, excludedSearchLanguages, includedSearchLanguages } from '@lib/searchLanguages';

describe('includedSearchLanguages', () => {
  it('matches every translation language when the filter is absent', () => {
    expect(includedSearchLanguages(undefined)).toEqual(['EN', 'ES']);
    expect(includedSearchLanguages(null)).toEqual(['EN', 'ES']);
  });

  it('treats the array form as the include list', () => {
    expect(includedSearchLanguages(['EN'])).toEqual(['EN']);
    expect(includedSearchLanguages(['ES'])).toEqual(['ES']);
    expect(includedSearchLanguages(['ES', 'EN'])).toEqual(['EN', 'ES']);
  });

  it('treats an empty array as Japanese only', () => {
    expect(includedSearchLanguages([])).toEqual([]);
  });

  it('inverts the legacy exclude form', () => {
    expect(includedSearchLanguages({ exclude: ['en'] })).toEqual(['ES']);
    expect(includedSearchLanguages({ exclude: ['EN', 'ES'] })).toEqual([]);
    expect(includedSearchLanguages({ exclude: [] })).toEqual(['EN', 'ES']);
    expect(includedSearchLanguages({})).toEqual(['EN', 'ES']);
  });

  it('accepts any casing and drops unknown codes', () => {
    expect(includedSearchLanguages(['en'])).toEqual(['EN']);
    expect(includedSearchLanguages(['eS', 'JA', 'fr'])).toEqual(['ES']);
    expect(includedSearchLanguages({ exclude: ['Es', 'de'] })).toEqual(['EN']);
  });

  it('is idempotent, so normalizing twice cannot flip the polarity', () => {
    for (const input of [['EN'], ['ES'], [], ['EN', 'ES']]) {
      expect(includedSearchLanguages(includedSearchLanguages(input))).toEqual(includedSearchLanguages(input));
    }
    const legacy = includedSearchLanguages({ exclude: ['en'] });
    expect(includedSearchLanguages(legacy)).toEqual(legacy);
  });
});

describe('excludedSearchLanguages', () => {
  it('excludes nothing when the filter is absent', () => {
    expect(excludedSearchLanguages(undefined)).toEqual([]);
    expect(excludedSearchLanguages(null)).toEqual([]);
  });

  it('is the complement of the include list', () => {
    expect(excludedSearchLanguages(['EN'])).toEqual(['ES']);
    expect(excludedSearchLanguages(['ES'])).toEqual(['EN']);
    expect(excludedSearchLanguages(['EN', 'ES'])).toEqual([]);
    expect(excludedSearchLanguages([])).toEqual([...SEARCH_LANGUAGES]);
  });

  it('excludes exactly the languages listed by the legacy form', () => {
    expect(excludedSearchLanguages({ exclude: ['en'] })).toEqual(['EN']);
    expect(excludedSearchLanguages({ exclude: ['ES'] })).toEqual(['ES']);
    expect(excludedSearchLanguages({ exclude: [] })).toEqual([]);
  });

  it('returns canonical uppercase codes regardless of input casing', () => {
    expect(excludedSearchLanguages({ exclude: ['en', 'es'] })).toEqual(['EN', 'ES']);
    expect(excludedSearchLanguages(['en'])).toEqual(['ES']);
  });
});
