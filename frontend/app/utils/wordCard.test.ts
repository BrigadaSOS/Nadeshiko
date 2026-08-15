import { describe, expect, it } from 'vitest';
import {
  cardSenses,
  glossPreference,
  kanjiIn,
  pitchMorae,
  selectDefinitions,
  shirabeKanjiUrl,
  shirabeWordUrl,
  type GlossPreference,
  type ShirabeWord,
} from './wordCard';

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

const WORD: ShirabeWord = {
  id: '焼ける',
  headword: '焼ける',
  reading: 'やける',
  common: true,
  jlpt: 'N3',
  frequency: 1421,
  pitch: [{ downstep: 0 }],
  entries: [
    {
      dictionary: 'jmdict',
      senses: [
        {
          position: 0,
          definitions: BILINGUAL,
          tags: [
            { category: 'partOfSpeech', code: 'v1', label: 'Ichidan verb' },
            { category: 'partOfSpeech', code: 'vi', label: 'intransitive verb' },
            { category: 'misc', code: 'uk', label: 'usually kana' },
            { category: 'field', code: 'food', label: 'food' },
            { category: 'name_type', code: 'surname', label: 'surname' },
          ],
        },
        { position: 1, definitions: ENGLISH_ONLY, tags: [] },
        // Spanish-only sense: invisible to a reader who hid Spanish, and the
        // fallback is what keeps it from vanishing instead.
        { position: 2, definitions: [{ lang: 'es', text: 'broncearse' }], tags: [] },
      ],
    },
  ],
};

describe('cardSenses', () => {
  it('splits the labels Shirabe resolved into parts of speech and misc tags', () => {
    const [first] = cardSenses(WORD, preference('en'));

    // Chips carry the short label keyed off the JMdict code, with JMdict's own
    // wording kept for the tooltip.
    expect(first?.partsOfSpeech).toEqual([
      { label: 'Ichidan verb', title: 'Ichidan verb', category: 'partOfSpeech' },
      { label: 'Intransitive verb', title: 'intransitive verb', category: 'partOfSpeech' },
    ]);
    expect(first?.tags).toEqual([
      { label: 'Usually kana', title: 'usually kana', category: 'misc' },
      { label: 'Food', title: 'food', category: 'field' },
    ]);
    // One row per language, badged, rather than one line that changes language
    // halfway through and reads as a single definition.
    expect(first?.glosses).toEqual([
      { lang: 'en', label: 'EN', text: 'to burn; to be roasted' },
      { lang: 'es', label: 'ES', text: 'quemarse' },
    ]);
  });

  it('writes the chips in the interface language, definitions or no definitions', () => {
    // Spanish reads its own glosses, so both halves of the card are Spanish.
    expect(cardSenses(WORD, preference('es'))[0]?.partsOfSpeech.map((chip) => chip.label)).toEqual([
      'Verbo ichidan',
      'Verbo intransitivo',
    ]);

    // Japanese is the case the gloss language cannot serve: no dictionary writes
    // definitions in Japanese, so this reader is reading English senses -- and
    // the chips are still the one thing on the card that can be said in their
    // own language.
    const japanese = cardSenses(WORD, preference('ja'))[0];
    expect(japanese?.partsOfSpeech.map((chip) => chip.label)).toEqual(['一段動詞', '自動詞']);
    expect(japanese?.glosses.map((row) => row.lang)).toEqual(['en', 'es']);
    // JMdict's own wording still rides along as the chip's tooltip: it is the
    // only place the untranslated detail survives.
    expect(japanese?.partsOfSpeech.map((chip) => chip.title)).toEqual(['Ichidan verb', 'intransitive verb']);
  });

  it('prints a part of speech once, not on every sense that repeats it', () => {
    const noun = { category: 'partOfSpeech', code: 'n', label: 'noun (common) (futsuumeishi)' };
    const suru = { category: 'partOfSpeech', code: 'vs', label: 'noun or participle taking the aux. verb suru' };
    const gloss = (text: string) => [{ lang: 'en', text }];

    const repetitive: ShirabeWord = {
      ...WORD,
      entries: [
        {
          dictionary: 'jmdict',
          senses: [
            { definitions: gloss('a face'), tags: [noun] },
            { definitions: gloss('an expression'), tags: [noun] },
            { definitions: gloss('to do the thing'), tags: [noun, suru] },
            // Back to a bare noun: it differs from the sense above, so it prints
            // again rather than being swallowed by the earlier run.
            { definitions: gloss('honour'), tags: [noun] },
          ],
        },
      ],
    };

    expect(
      cardSenses(repetitive, preference('en')).map((sense) => sense.partsOfSpeech.map((chip) => chip.label)),
    ).toEqual([['Noun'], [], ['Noun', 'Suru verb'], ['Noun']]);
  });

  it('compares against the chip the reader can see, not the sense above', () => {
    // Three senses of the same part of speech. Comparing each against its
    // immediate predecessor's own labels would blank the second and then print
    // the third again, because the second's are empty by then.
    const noun = { category: 'partOfSpeech', code: 'n', label: 'noun' };
    const run: ShirabeWord = {
      ...WORD,
      entries: [
        {
          dictionary: 'jmdict',
          senses: [1, 2, 3].map((n) => ({ definitions: [{ lang: 'en', text: `sense ${n}` }], tags: [noun] })),
        },
      ],
    };

    expect(cardSenses(run, preference('en')).map((sense) => sense.partsOfSpeech.length)).toEqual([1, 0, 0]);
  });

  it('carries no usage qualifier down, only the part of speech', () => {
    // "usually kana" on one sense and not the next is a real difference between
    // them, so it is printed wherever it belongs.
    const noun = { category: 'partOfSpeech', code: 'n', label: 'noun' };
    const uk = { category: 'misc', code: 'uk', label: 'usually written using kana alone' };
    const mixed: ShirabeWord = {
      ...WORD,
      entries: [
        {
          dictionary: 'jmdict',
          senses: [
            { definitions: [{ lang: 'en', text: 'one' }], tags: [noun, uk] },
            { definitions: [{ lang: 'en', text: 'two' }], tags: [noun, uk] },
          ],
        },
      ],
    };

    const senses = cardSenses(mixed, preference('en'));
    expect(senses.map((sense) => sense.partsOfSpeech.length)).toEqual([1, 0]);
    expect(senses.map((sense) => sense.tags.map((chip) => chip.label))).toEqual([['Usually kana'], ['Usually kana']]);
  });

  it('keeps a sense the reader language cannot cover, in the other language', () => {
    const senses = cardSenses(WORD, preference('en', 'show', 'hidden'));

    expect(senses.map((sense) => sense.glosses)).toEqual([
      [{ lang: 'en', label: 'EN', text: 'to burn; to be roasted' }],
      [{ lang: 'en', label: 'EN', text: 'to be jealous' }],
      [{ lang: 'es', label: 'ES', text: 'broncearse' }],
    ]);
  });

  it('drops a sense with nothing to say', () => {
    const empty: ShirabeWord = {
      ...WORD,
      entries: [{ dictionary: 'jmdict', senses: [{ definitions: [], tags: [] }, { definitions: BILINGUAL }] }],
    };

    expect(cardSenses(empty, preference('en'))).toHaveLength(1);
  });

  it('stops at the limit rather than growing the card without end', () => {
    const many: ShirabeWord = {
      ...WORD,
      entries: [
        {
          dictionary: 'jmdict',
          senses: Array.from({ length: 12 }, (_, i) => ({ definitions: [{ lang: 'en', text: `sense ${i}` }] })),
        },
      ],
    };

    expect(cardSenses(many, preference('en'), 6)).toHaveLength(6);
  });

  it('answers a word that never loaded with nothing', () => {
    expect(cardSenses(null, preference('en'))).toEqual([]);
  });
});

describe('kanjiIn', () => {
  it('lists each distinct kanji, in writing order', () => {
    expect(kanjiIn('焼ける')).toEqual(['焼']);
    expect(kanjiIn('人人')).toEqual(['人']);
    expect(kanjiIn('日本語')).toEqual(['日', '本', '語']);
  });

  it('finds no kanji in a kana word', () => {
    expect(kanjiIn('フライパン')).toEqual([]);
  });
});

describe('pitchMorae', () => {
  it('keeps a small kana with the mora it belongs to', () => {
    expect(pitchMorae('きょう', 1).map((mora) => mora.text)).toEqual(['きょ', 'う']);
  });

  it('rises after the first mora and stays up for heiban', () => {
    expect(pitchMorae('やける', 0).map((mora) => mora.high)).toEqual([false, true, true]);
    expect(pitchMorae('やける', 0).some((mora) => mora.drop)).toBe(false);
  });

  it('is high on the first mora only for atamadaka', () => {
    expect(pitchMorae('はし', 1).map((mora) => mora.high)).toEqual([true, false]);
    expect(pitchMorae('はし', 1).map((mora) => mora.drop)).toEqual([true, false]);
  });

  it('falls after the downstep for nakadaka and odaka', () => {
    expect(pitchMorae('たまご', 2).map((mora) => mora.high)).toEqual([false, true, false]);
    expect(pitchMorae('はな', 2).map((mora) => mora.drop)).toEqual([false, true]);
  });
});

describe('shirabe links', () => {
  it('links a word and a kanji into the reader own locale, so no redirect runs', () => {
    expect(shirabeWordUrl('焼ける-やける', 'es')).toBe(
      'https://shirabe.org/es/word/%E7%84%BC%E3%81%91%E3%82%8B-%E3%82%84%E3%81%91%E3%82%8B?utm_source=nadeshiko&utm_medium=referral&utm_content=word-card',
    );
    expect(shirabeKanjiUrl('焼', 'en')).toBe(
      'https://shirabe.org/en/kanji/%E7%84%BC?utm_source=nadeshiko&utm_medium=referral&utm_content=kanji-chip',
    );
  });

  it('attributes the visit to Nadeshiko, naming the link that was taken', () => {
    // These links are `rel="noopener noreferrer"`, so Shirabe gets no `Referer`
    // at all -- without the parameters its PostHog files every one of these as
    // direct traffic. `utm_*` because stock posthog-js reads exactly these names.
    const word = new URL(shirabeWordUrl('焼ける-やける', 'es')).searchParams;
    expect(Object.fromEntries(word)).toEqual({
      utm_source: 'nadeshiko',
      utm_medium: 'referral',
      utm_content: 'word-card',
    });

    // The two surfaces are told apart, so it stays visible which half of the
    // card sends readers on.
    expect(new URL(shirabeKanjiUrl('焼', 'en')).searchParams.get('utm_content')).toBe('kanji-chip');
  });

  it('keeps the word id readable on the other side', () => {
    // The id is a path segment and the parameters are a query, so appending one
    // must not disturb the other.
    expect(new URL(shirabeWordUrl('焼ける-やける', 'es')).pathname).toBe(
      '/es/word/%E7%84%BC%E3%81%91%E3%82%8B-%E3%82%84%E3%81%91%E3%82%8B',
    );
  });

  it('can name a different surface without changing the path', () => {
    const url = new URL(shirabeWordUrl('焼ける-やける', 'en', 'anki-definition'));
    expect(url.pathname).toBe('/en/word/%E7%84%BC%E3%81%91%E3%82%8B-%E3%82%84%E3%81%91%E3%82%8B');
    expect(url.searchParams.get('utm_content')).toBe('anki-definition');
  });
});
