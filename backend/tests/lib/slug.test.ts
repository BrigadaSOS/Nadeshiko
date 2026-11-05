import { describe, it, expect } from 'vitest';
import { FALLBACK_SLUG, pickSlugSource, slugify } from '@lib/utils/slug';

describe('pickSlugSource', () => {
  it('prefers an ASCII romaji name', () => {
    expect(pickSlugSource('Spy x Family', 'SPY x FAMILY')).toBe('Spy x Family');
  });

  it('uses the English name when the romaji one has Japanese characters', () => {
    expect(pickSlugSource('スパイファミリー', 'Spy x Family')).toBe('Spy x Family');
  });

  it('skips names that slugify to nothing', () => {
    // A Japanese-only YouTube channel: every name is its Japanese title.
    const name = 'しおりのなんとなく日常';
    expect(slugify(name)).toBe('');
    expect(pickSlugSource(name, name, ['UCauyM-A8JIJ9NQcw5_jF00Q'])).toBe('UCauyM-A8JIJ9NQcw5_jF00Q');
  });

  it('keeps the ASCII part of a mixed romaji name before any fallback', () => {
    expect(pickSlugSource('Oregairu 俺ガイル', '俺ガイル', ['B07PPMBZHX'])).toBe('Oregairu 俺ガイル');
  });

  it('ignores missing fallbacks and ends with a fixed slug', () => {
    expect(pickSlugSource('日常', null, [null, undefined, ''])).toBe(FALLBACK_SLUG);
    expect(pickSlugSource(undefined, undefined)).toBe(FALLBACK_SLUG);
  });
});
