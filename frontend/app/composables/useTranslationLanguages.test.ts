import { describe, expect, it } from 'vitest';
import { defaultTranslationLanguages, normalizeTranslationLanguages } from './useTranslationLanguages';

describe('translation language defaults', () => {
  it('uses the interface language until a reader saves an override', () => {
    expect(defaultTranslationLanguages('en')).toEqual(['EN']);
    expect(defaultTranslationLanguages('es')).toEqual(['ES']);
    expect(defaultTranslationLanguages('ja')).toEqual(['EN', 'ES']);
  });

  it('keeps a saved order and rejects invalid values', () => {
    expect(normalizeTranslationLanguages(['ES', 'EN'], 'en')).toEqual(['ES', 'EN']);
    expect(normalizeTranslationLanguages(['ES', 'ES', 'FR'], 'en')).toEqual(['ES']);
    expect(normalizeTranslationLanguages([], 'es')).toEqual(['ES']);
  });
});
