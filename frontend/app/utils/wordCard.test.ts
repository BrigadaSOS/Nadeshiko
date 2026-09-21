import { describe, expect, it } from 'vitest';
import { glossPreference, selectDefinitions, type GlossPreference } from './wordCard';

// Shirabe returns every language an entry has, so a definition list is what a
// reader preference has to be applied TO, not what it can be asked for.
const BILINGUAL = [
  { lang: 'en', text: 'to burn' },
  { lang: 'en', text: 'to be roasted' },
  { lang: 'es', text: 'quemarse' },
];
const ENGLISH_ONLY = [{ lang: 'en', text: 'to be jealous' }];
const WITH_FRENCH = [
  { lang: 'fr', text: 'brûler' },
  { lang: 'en', text: 'to burn' },
];

const preference = (
  uiLocale: string,
  english: 'show' | 'spoiler' | 'hidden' = 'show',
  spanish: 'show' | 'spoiler' | 'hidden' = 'show',
): GlossPreference => glossPreference(uiLocale, { en: english, es: spanish });

const texts = (definitions: Array<{ text: string }>) => definitions.map((definition) => definition.text);

describe('glossPreference', () => {
  it('puts the reader own language first', () => {
    expect(preference('es').order).toEqual(['es', 'en']);
    expect(preference('en').order).toEqual(['en', 'es']);
  });

  it('serves the Japanese interface English, the language JMdict is written in', () => {
    expect(preference('ja').order).toEqual(['en', 'es']);
    expect(preference('ja').labels).toBe('en');
  });

  it('drops a hidden language from the order', () => {
    expect(preference('en', 'hidden', 'show').order).toEqual(['es']);
    expect(preference('es', 'show', 'hidden').order).toEqual(['en']);
  });

  it('treats spoiler as shown, because a tooltip is opened on purpose', () => {
    expect(preference('en', 'spoiler', 'spoiler').order).toEqual(['en', 'es']);
  });

  it('uses the saved global order instead of the interface language', () => {
    expect(glossPreference('en', { en: 'show', es: 'show' }, ['es', 'en']).order).toEqual(['es', 'en']);
  });

  it('does not fall back to a globally excluded language', () => {
    const spanishOnly = glossPreference('en', { en: 'show', es: 'show' }, ['es']);
    expect(texts(selectDefinitions(ENGLISH_ONLY, spanishOnly))).toEqual([]);
  });

  it('resolves tag labels into the primary enabled language, not the interface one', () => {
    expect(preference('en').labels).toBe('en');
    expect(preference('es').labels).toBe('es');
    // Reading the site in English with English definitions off: the labels
    // follow the definitions, so the card does not read in two languages.
    expect(preference('en', 'hidden', 'show').labels).toBe('es');
  });

  it('keeps a label language even when the reader has hidden everything', () => {
    const both = preference('es', 'hidden', 'hidden');

    expect(both.order).toEqual([]);
    expect(both.labels).toBe('es');
  });
});

describe('selectDefinitions', () => {
  it('shows both languages, the reader own first, when both are on', () => {
    expect(texts(selectDefinitions(BILINGUAL, preference('es')))).toEqual(['quemarse', 'to burn', 'to be roasted']);
    expect(texts(selectDefinitions(BILINGUAL, preference('en')))).toEqual(['to burn', 'to be roasted', 'quemarse']);
  });

  it('shows only Spanish when English is hidden', () => {
    expect(texts(selectDefinitions(BILINGUAL, preference('es', 'hidden', 'show')))).toEqual(['quemarse']);
  });

  it('shows only English when Spanish is hidden', () => {
    expect(texts(selectDefinitions(BILINGUAL, preference('en', 'show', 'hidden')))).toEqual([
      'to burn',
      'to be roasted',
    ]);
  });

  it('falls back to English when the reader language has no gloss', () => {
    // The whole point: a missing translation is worse than the wrong language.
    expect(texts(selectDefinitions(ENGLISH_ONLY, preference('es', 'hidden', 'show')))).toEqual(['to be jealous']);
  });

  // Hiding one language is "I read the other one", so a word with no gloss there
  // still gets one. Hiding both is "I do not want translations", and handing that
  // reader MORE text than the stricter-looking preference gets would be perverse.
  // The rest of the card still answers: the word, its reading, its form, its kanji.
  it('gives a reader who hid every language no definitions at all', () => {
    expect(selectDefinitions(BILINGUAL, preference('es', 'hidden', 'hidden'))).toEqual([]);
  });

  it('never shows a language nobody asked for', () => {
    expect(texts(selectDefinitions(WITH_FRENCH, preference('en')))).toEqual(['to burn']);
    expect(selectDefinitions([{ lang: 'fr', text: 'brûler' }], preference('en'))).toEqual([]);
  });

  it('answers an entry with no definitions with nothing', () => {
    expect(selectDefinitions(undefined, preference('en'))).toEqual([]);
    expect(selectDefinitions([], preference('en'))).toEqual([]);
  });
});
