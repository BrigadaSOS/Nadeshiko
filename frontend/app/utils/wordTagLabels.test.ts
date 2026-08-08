import { describe, expect, it } from 'vitest';
import { posSlug, tagLabel, tagLanguage } from './wordTagLabels';

describe('tagLanguage', () => {
  it('is the interface language, and Japanese is one of them', () => {
    expect(tagLanguage('en')).toBe('en');
    expect(tagLanguage('es')).toBe('es');
    expect(tagLanguage('ja')).toBe('ja');
  });

  it('falls back to English for a locale we ship no chips in', () => {
    expect(tagLanguage('fr')).toBe('en');
    expect(tagLanguage('')).toBe('en');
  });
});

describe('posSlug', () => {
  it('matches the verb and adjective families by prefix', () => {
    // JMdict spells out every godan ending rather than tagging the class once.
    expect(posSlug('v5k')).toBe('godan-verb');
    expect(posSlug('v5aru')).toBe('godan-verb');
    expect(posSlug('v1-s')).toBe('ichidan-verb');
    expect(posSlug('v2a-s')).toBe('classical-verb');
    expect(posSlug('v4r')).toBe('classical-verb');
    expect(posSlug('vz')).toBe('verb');
    expect(posSlug('adj-kari')).toBe('adjective');
  });

  it('prefers the exact code over the family it starts with', () => {
    expect(posSlug('vs-i')).toBe('suru-verb');
    expect(posSlug('vt')).toBe('transitive-verb');
    expect(posSlug('adj-i')).toBe('i-adjective');
    expect(posSlug('adj-na')).toBe('na-adjective');
  });

  it('has nothing for a code the legend does not cover', () => {
    expect(posSlug('unc')).toBeUndefined();
  });
});

describe('tagLabel', () => {
  it('writes a part of speech in the reader language', () => {
    expect(tagLabel('partOfSpeech', 'n', 'noun (common) (futsuumeishi)', 'en')).toBe('Noun');
    expect(tagLabel('partOfSpeech', 'n', 'noun (common) (futsuumeishi)', 'es')).toBe('Sustantivo');
    expect(tagLabel('partOfSpeech', 'n', 'noun (common) (futsuumeishi)', 'ja')).toBe('名詞');
  });

  it('writes a usage qualifier in the reader language', () => {
    expect(tagLabel('misc', 'uk', 'usually written using kana alone', 'es')).toBe('Normalmente en kana');
    expect(tagLabel('misc', 'on-mim', 'onomatopoeic or mimetic word', 'ja')).toBe('擬音・擬態語');
  });

  it('gives Japanese English where the legend has no Japanese term', () => {
    // Shirabe leaves `jp` blank for a handful of register flags; borrowing the
    // Spanish would be worse than borrowing the language the rest of a Japanese
    // reader card is already in.
    expect(tagLabel('misc', 'vulg', 'vulgar expression or word', 'ja')).toBe('Vulgar');
    expect(tagLabel('misc', 'arch', 'archaic', 'ja')).toBe('Archaic');
  });

  it('keeps num and ctr apart, where the legend merges them', () => {
    expect(tagLabel('partOfSpeech', 'num', 'numeric', 'en')).toBe('Numeric');
    expect(tagLabel('partOfSpeech', 'ctr', 'counter', 'en')).toBe('Counter');
    expect(tagLabel('partOfSpeech', 'num', 'numeric', 'ja')).toBe('数詞');
    expect(tagLabel('partOfSpeech', 'ctr', 'counter', 'ja')).toBe('助数詞');
  });

  it('files every proper-name tag under one entry', () => {
    expect(tagLabel('misc', 'surname', 'family or surname', 'es')).toBe('Nombre / entidad');
    expect(tagLabel('misc', 'company', 'company name', 'es')).toBe('Nombre / entidad');
  });

  it('shortens JMdict own wording for a tag with no legend entry', () => {
    // Fields and dialects carry no entry, and there is no translation of them to
    // reach for -- so they print the dictionary label, tidied.
    expect(tagLabel('field', 'comp', 'computing', 'ja')).toBe('Computing');
    expect(tagLabel('dialect', 'ksb', 'Kansai-ben - Kansai dialect', 'es')).toBe('Kansai-ben');
    expect(tagLabel('partOfSpeech', 'unc', 'unclassified (unc)', 'en')).toBe('Unclassified');
  });

  it('falls back to the bare code when there is nothing left to print', () => {
    expect(tagLabel('field', 'xyz', '(obscure)', 'en')).toBe('xyz');
  });
});
