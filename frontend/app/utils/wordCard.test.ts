import { describe, expect, it } from 'vitest';
import {
  cardExamples,
  cardSenses,
  exampleTokens,
  glossPreference,
  kanjiIn,
  pitchMorae,
  selectDefinitions,
  shirabeKanjiUrl,
  shirabeWordUrl,
  translationRows,
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

  it('resolves tag labels into the primary enabled language, not the interface one', () => {
    expect(preference('en').labels).toBe('en');
    expect(preference('es').labels).toBe('es');
    // Reading the site in English with English definitions off: the labels
    // follow the definitions, so the card does not read in two languages.
    expect(preference('en', 'hidden', 'show').labels).toBe('es');
  });

  it('carries the modes, because a shown row and a spoiler row are not the same row', () => {
    expect(preference('en', 'spoiler', 'hidden').modes).toEqual({ en: 'spoiler', es: 'hidden' });
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
  examples: [
    {
      japanese: '肉が焼けた。',
      translations: [{ lang: 'en', text: 'The meat is done.' }],
      tokens: [
        { surface: '肉', lemma: '肉', content: true, matched: false },
        { surface: 'が', lemma: 'が', content: true, matched: false },
        { surface: '焼けた', lemma: '焼ける', content: true, matched: true },
        { surface: '。', lemma: '。', content: false, matched: false },
      ],
    },
    // Sent before Shirabe tokenized its examples: still worth printing, just not
    // clickable.
    { japanese: '家が焼けた。', translations: [] },
    {
      japanese: 'パンが焼ける。',
      translations: [
        { lang: 'es', text: 'El pan se hornea.' },
        { lang: 'en', text: 'The bread bakes.' },
      ],
      tokens: [
        { surface: 'パン', lemma: 'パン', content: true, matched: false },
        { surface: 'が', lemma: 'が', content: true, matched: false },
        { surface: '焼ける', lemma: '焼ける', content: true, matched: true },
        { surface: '。', lemma: '。', content: false, matched: false },
      ],
    },
  ],
};

describe('cardSenses', () => {
  it('splits the labels Shirabe resolved into parts of speech and misc tags', () => {
    const [first] = cardSenses(WORD, preference('en'));

    expect(first?.partsOfSpeech).toEqual(['Ichidan verb', 'intransitive verb']);
    expect(first?.tags).toEqual(['usually kana', 'food']);
    // One row per language, badged, rather than one line that changes language
    // halfway through and reads as a single definition.
    expect(first?.glosses).toEqual([
      { lang: 'en', label: 'EN', text: 'to burn; to be roasted' },
      { lang: 'es', label: 'ES', text: 'quemarse' },
    ]);
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

describe('exampleTokens', () => {
  const SENTENCE = (WORD.examples ?? [])[0] ?? { japanese: '' };

  it('makes a content word searchable by its dictionary form', () => {
    // 焼けた finds one sentence; 焼ける finds the corpus.
    expect(exampleTokens(SENTENCE)).toEqual([
      { text: '肉', query: '肉', matched: false },
      { text: 'が', query: 'が', matched: false },
      { text: '焼けた', query: '焼ける', matched: true },
      { text: '。', query: null, matched: false },
    ]);
  });

  it('searches the surface when Shirabe knew no dictionary form', () => {
    const tokens = exampleTokens({
      japanese: 'ゲームばかり',
      tokens: [{ surface: 'ゲーム', content: true, matched: false }],
    });

    expect(tokens).toEqual([{ text: 'ゲーム', query: 'ゲーム', matched: false }]);
  });

  it('marks the word the card is about, compound or not', () => {
    const tokens = exampleTokens({
      japanese: '兄ちゃん',
      tokens: [{ surface: '兄ちゃん', lemma: '兄ちゃん', content: true, matched: true }],
    });

    expect(tokens.map((token) => token.matched)).toEqual([true]);
  });

  it('leaves a sentence Shirabe sent no tokens for to print as it came', () => {
    expect(exampleTokens({ japanese: '家が焼けた。' })).toEqual([]);
  });
});

describe('translationRows', () => {
  const TRANSLATIONS = [
    { lang: 'en', text: 'The bread bakes.' },
    { lang: 'es', text: 'El pan se hornea.' },
  ];

  it('puts the reader own language first, badged like the segment rows', () => {
    expect(translationRows(TRANSLATIONS, preference('es'))).toEqual([
      { lang: 'es', label: 'ES', mode: 'show', text: 'El pan se hornea.' },
      { lang: 'en', label: 'EN', mode: 'show', text: 'The bread bakes.' },
    ]);
    expect(translationRows(TRANSLATIONS, preference('en')).map((row) => row.lang)).toEqual(['en', 'es']);
  });

  it('gives a hidden language no row at all', () => {
    expect(translationRows(TRANSLATIONS, preference('en', 'hidden', 'show')).map((row) => row.label)).toEqual(['ES']);
    expect(translationRows(TRANSLATIONS, preference('en', 'hidden', 'hidden'))).toEqual([]);
  });

  // Unlike a definition, which borrows the language the reader turned off rather
  // than leave the card empty. A sentence is already there in Japanese, so
  // hiding English here means what it says.
  it('never falls back to a language the reader hid', () => {
    const english = [{ lang: 'en', text: 'The bread bakes.' }];

    expect(translationRows(english, preference('es', 'hidden', 'show'))).toEqual([]);
  });

  it('carries the spoiler mode through, so the row can cover itself', () => {
    expect(translationRows(TRANSLATIONS, preference('en', 'spoiler', 'show')).map((row) => row.mode)).toEqual([
      'spoiler',
      'show',
    ]);
  });

  it('renders no row for a language this sentence was never translated into', () => {
    expect(
      translationRows([{ lang: 'en', text: 'The meat is done.' }], preference('en')).map((row) => row.lang),
    ).toEqual(['en']);
    expect(translationRows(undefined, preference('en'))).toEqual([]);
    expect(translationRows([{ lang: 'fr', text: 'Le pain cuit.' }], preference('en'))).toEqual([]);
  });
});

describe('cardExamples', () => {
  it('translates an example into every language the reader reads, and prefers the translated ones', () => {
    const [first, second] = cardExamples(WORD, preference('es'));

    expect(first?.japanese).toBe('肉が焼けた。');
    expect(first?.translations).toEqual([{ lang: 'en', label: 'EN', mode: 'show', text: 'The meat is done.' }]);
    expect(second?.translations.map((row) => row.text)).toEqual(['El pan se hornea.', 'The bread bakes.']);
  });

  it('splits each sentence into words a click can search', () => {
    const [first] = cardExamples(WORD, preference('en'));

    expect(first?.tokens.map((token) => token.query)).toEqual(['肉', 'が', '焼ける', null]);
  });

  it('still shows an untranslated sentence when there is room', () => {
    expect(cardExamples(WORD, preference('en'), 3)[2]).toEqual({
      japanese: '家が焼けた。',
      tokens: [],
      translations: [],
    });
  });

  it('shows the sentences a reader who hid every language can still read', () => {
    const examples = cardExamples(WORD, preference('es', 'hidden', 'hidden'));

    expect(examples.map((example) => example.japanese)).toEqual(['肉が焼けた。', '家が焼けた。']);
    expect(examples.every((example) => example.translations.length === 0)).toBe(true);
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
      'https://shirabe.org/es/word/%E7%84%BC%E3%81%91%E3%82%8B-%E3%82%84%E3%81%91%E3%82%8B',
    );
    expect(shirabeKanjiUrl('焼', 'en')).toBe('https://shirabe.org/en/kanji/%E7%84%BC');
  });
});
