import { describe, expect, it } from 'vitest';
import {
  candidateName,
  candidatePartOfSpeech,
  candidateSummary,
  pickerChips,
  cardForms,
  cardHeadword,
  lookupState,
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

/**
 * The invariant the candidate picker broke on its first outing: the head, the
 * corpus search and the Anki probe all have to name the SAME word, and the
 * reader can move which word that is.
 */
describe('cardHeadword', () => {
  const candidate = (headword: string) => ({ id: headword, headword }) as ShirabeWord;

  it('names the word the reader picked, not the token they clicked', () => {
    // きみ was the spelling in the sentence; 黄身 is what they chose it meant.
    expect(cardHeadword(candidate('黄身'), 'きみ')).toBe('黄身');
  });

  // The bug this exists to prevent. Search and mine used to read the token
  // directly, so picking moved the definitions and left them behind.
  it('moves with the pick, so search and mine cannot drift from the head', () => {
    const before = cardHeadword(candidate('君'), 'きみ');
    const after = cardHeadword(candidate('黄身'), 'きみ');

    expect(before).not.toBe(after);
  });

  // Answers before the lookup lands, which is what lets the Anki probe start
  // the moment the card opens rather than waiting on a dictionary call.
  it('falls back to the token while there is no word yet', () => {
    expect(cardHeadword(null, '食べる')).toBe('食べる');
  });

  // A name, a coinage, a spelling the corpus preserved: no entry, but the
  // reader is still looking at a word and can still mine it.
  it('still names the word when the dictionary had no entry', () => {
    expect(cardHeadword(null, 'ズガガガ')).toBe('ズガガガ');
  });

  // Empty is what closes the mining probe down; a card about nothing must not
  // leave Anki being asked about the last word the reader looked at.
  it('is empty once the card is closed', () => {
    expect(cardHeadword(null, undefined)).toBe('');
  });
});

/**
 * The picker row. Its one genuinely dangerous property is the index: trimming
 * the row makes the loop index and the position in the full list disagree, and
 * the pick addresses the full list.
 */
describe('pickerChips', () => {
  const list = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `w${i}`, headword: `w${i}` }) as ShirabeWord);

  it('draws everything when the list is short enough', () => {
    expect(pickerChips(list(4), 0, false, 6).map((c) => c.index)).toEqual([0, 1, 2, 3]);
  });

  it('trims a long row to the limit', () => {
    expect(pickerChips(list(12), 0, false, 6)).toHaveLength(6);
  });

  // The bug this function exists to prevent: a chip's index must address the
  // FULL list, not its position in the trimmed row.
  it('carries the index from the full list, not from the row', () => {
    const chips = pickerChips(list(12), 9, false, 6);
    const picked = chips.find((c) => c.candidate.id === 'w9');

    expect(picked?.index).toBe(9);
  });

  // Pick from the expanded row, collapse it, and the card must not be showing a
  // word whose chip has gone.
  it('keeps the picked candidate in a trimmed row', () => {
    const chips = pickerChips(list(12), 9, false, 6);

    expect(chips.some((c) => c.index === 9)).toBe(true);
    expect(chips).toHaveLength(6);
  });

  it('shows the whole ranked list once expanded', () => {
    expect(pickerChips(list(12), 0, true, 6)).toHaveLength(12);
  });

  // Nothing is filtered away, only held back: every candidate is still reachable.
  it('never drops a candidate the expanded row would not show', () => {
    const all = pickerChips(list(12), 0, true, 6).map((c) => c.index);

    expect(all).toEqual([...Array(12).keys()]);
  });
});

/**
 * The forms row exists to connect the spelling a reader MET to the headword
 * they are being shown. Its whole job is the spellings that are not already on
 * the card.
 */
describe('cardForms', () => {
  const word = (forms: Array<{ text: string; script?: string }>): ShirabeWord =>
    ({ id: '開く', headword: '開く', reading: 'ひらく', forms }) as ShirabeWord;

  it('answers the spellings the card is not already showing', () => {
    expect(cardForms(word([{ text: '開く' }, { text: '空く' }, { text: 'ヒラく' }]))).toEqual(['空く', 'ヒラく']);
  });

  // Both are an inch above in the head; repeating them spends the row on
  // something the reader can already see.
  it('never repeats the headword or the reading', () => {
    expect(cardForms(word([{ text: '開く' }, { text: 'ひらく' }]))).toEqual([]);
  });

  it('drops duplicates and blanks', () => {
    expect(cardForms(word([{ text: '空く' }, { text: '空く' }, { text: '  ' }]))).toEqual(['空く']);
  });

  // A supporting row, not the point of the card: a word with a dozen rare
  // spellings must not push the definitions off the bottom.
  it('caps a long list', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ text: `form${i}` }));
    expect(cardForms(word(many), 4)).toHaveLength(4);
  });

  it('answers nothing for a word with no forms, or no word at all', () => {
    expect(cardForms(word([]))).toEqual([]);
    expect(cardForms(null)).toEqual([]);
  });
});

/**
 * The distinction that decides what a reader is told when the dictionary is
 * down. Getting it wrong is invisible in tests of the happy path and very
 * visible to a reader: either the card blames the dictionary for our outage, or
 * it says nothing and looks broken.
 */
describe('lookupState', () => {
  it('shows the card when there are candidates', () => {
    expect(lookupState(3, undefined)).toBe('shown');
  });

  // A fact about the WORD -- a name, a coinage, a spelling the corpus kept --
  // and the end of the search, so the card says it out loud.
  it('says no entry when the dictionary answered and had none', () => {
    expect(lookupState(0, 'missing')).toBe('missing');
  });

  // A fact about US. Reporting it as "no entry" would be a lie about a word that
  // may well be in the dictionary, and one the reader cannot check.
  it('does not blame the word when the request failed', () => {
    expect(lookupState(0, 'failed')).toBe('unavailable');
  });

  // The regression this exists to prevent: a failed lookup used to fall through
  // to a state with no message, leaving a headword over blank space that reads
  // as still loading.
  it('never leaves a failure with nothing to say', () => {
    expect(lookupState(0, 'failed')).not.toBe('shown');
    expect(lookupState(0, 'failed')).toBeTruthy();
  });

  // Candidates win over any reason: an answer that arrived is an answer.
  it('prefers what arrived over why it might not have', () => {
    expect(lookupState(2, 'failed')).toBe('shown');
  });
});

/**
 * A reader who linked their Shirabe account and put a monolingual dictionary
 * above JMdict. Everything below is about what changes on the card when the
 * definitions stop coming from one dictionary in one of two languages.
 */
const STACKED: ShirabeWord = {
  id: '開く',
  headword: '開く',
  reading: 'ひらく',
  common: true,
  jlpt: 'N4',
  frequency: 900,
  pitch: [{ downstep: 2 }],
  entries: [
    {
      dictionary: 'sanseido',
      senses: [{ position: 0, definitions: [{ lang: 'ja', text: 'とじていたものをあける' }], tags: [] }],
    },
    {
      dictionary: 'jmdict',
      senses: [{ position: 0, definitions: [{ lang: 'en', text: 'to open' }], tags: [] }],
    },
  ],
};

describe('a card built from more than one dictionary', () => {
  // The reason this is not governed by the en/es visibility preference: a
  // monolingual dictionary only reaches this card because the reader put it in
  // their own Shirabe stack, which says more than any toggle here does. Before
  // this, every one of its senses was dropped for having no gloss "the reader
  // can read" and the card silently showed only JMdict.
  it('prints Japanese definitions from a dictionary the reader chose', () => {
    const senses = cardSenses(STACKED, preference('en'));

    expect(senses.map((sense) => sense.glosses[0]?.text)).toEqual(['とじていたものをあける', 'to open']);
    expect(senses[0]?.glosses[0]?.lang).toBe('ja');
  });

  // The language is data; the badge is presentation, and Japanese needs none of
  // it. EN and ES are both Latin script and a reader with both on has to be told
  // which one they are looking at; Japanese says so by being Japanese, and a JA
  // down every row of a monolingual dictionary is a column of noise.
  it('badges the languages that need one, and not Japanese', () => {
    const senses = cardSenses(STACKED, preference('en'));

    expect(senses[0]?.glosses[0]?.label).toBe('');
    expect(senses[1]?.glosses[0]?.label).toBe('EN');
  });

  // Entries arrive in the key owner's stack order, and the card must not
  // reorder them: putting a monolingual dictionary first is the whole reason
  // somebody configures a stack.
  it('keeps the reader dictionary order', () => {
    expect(cardSenses(STACKED, preference('en')).map((sense) => sense.dictionary)).toEqual(['sanseido', 'jmdict']);
  });

  it('still prefers a real gloss language over Japanese when the entry has one', () => {
    expect(texts(selectDefinitions([...BILINGUAL, { lang: 'ja', text: 'やける' }], preference('en')))).toEqual([
      'to burn',
      'to be roasted',
      'quemarse',
    ]);
  });

  // JMdict ships French, German, Dutch and Russian too, and none of those is a
  // language anybody here chose. Widening to Japanese must not widen to those.
  it('does not print a language nobody asked for', () => {
    expect(selectDefinitions(WITH_FRENCH, preference('es', 'hidden', 'hidden'))).toEqual([]);
  });
});

describe('candidateSummary', () => {
  const summary = (word: ShirabeWord, pref = preference('en')) => candidateSummary(word, pref);

  // The whole point of the row: a spelling is only a recognisable label to
  // someone who already knows the word, which is not the reader looking it up.
  it('says what the candidate means', () => {
    expect(summary(WORD)).toBe('to burn; to be roasted');
  });

  // Same rules as the opened card, so the preview never disagrees with what it
  // previews.
  it('follows the reader gloss language', () => {
    expect(summary(WORD, preference('es'))).toBe('quemarse');
  });

  it('reads a monolingual dictionary the reader put in their stack', () => {
    expect(summary(STACKED)).toBe('とじていたものをあける');
  });

  it('is empty for a candidate with nothing renderable', () => {
    expect(summary({ ...WORD, entries: [] })).toBe('');
  });

  it('truncates a long gloss on a word boundary', () => {
    const wordy = {
      ...WORD,
      entries: [
        {
          dictionary: 'jmdict',
          senses: [
            {
              position: 0,
              definitions: [{ lang: 'en', text: 'these past ... (e.g. three years); these last several days' }],
              tags: [],
            },
          ],
        },
      ],
    };

    const text = summary(wordy);
    expect(text.endsWith('…')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(43);
    expect(text).not.toMatch(/\s…$/);
  });
});

/**
 * The fourth answer. A token that resolves only to people -- 明日香, 田中, every
 * character in a subtitle corpus -- used to be told "no dictionary entry", which
 * is false: the dictionary has it, the route dropped the name rows.
 */
describe('lookupState with names', () => {
  it('is a name when the only candidates were names', () => {
    expect(lookupState(3, undefined, true)).toBe('name');
  });

  // The case the rule turns on: names are dropped only while a real word is
  // there to compete with, so a list that still has words is an ordinary answer.
  it('is an ordinary answer when a real word survived', () => {
    expect(lookupState(5, undefined, false)).toBe('shown');
    expect(lookupState(5, undefined)).toBe('shown');
  });

  // An empty list is still empty however it got that way: `nameOnly` describes
  // what the candidates ARE, and there are none.
  it('never reads an empty list as a name', () => {
    expect(lookupState(0, 'missing', true)).toBe('missing');
    expect(lookupState(0, 'failed', true)).toBe('unavailable');
  });
});

/**
 * Two candidates with the same spelling. あれ answers twice — the pronoun and
 * the interjection — and a picker showing あれ twice asks a question it has not
 * given the reader the means to answer.
 */
describe('candidatePartOfSpeech', () => {
  const withPos = (code: string, label: string): ShirabeWord =>
    ({
      ...WORD,
      entries: [
        {
          dictionary: 'jmdict',
          senses: [
            {
              position: 0,
              definitions: [{ lang: 'en', text: 'that' }],
              tags: [{ category: 'partOfSpeech', code, label }],
            },
          ],
        },
      ],
    }) as ShirabeWord;

  it('names what the spelling cannot', () => {
    expect(candidatePartOfSpeech(withPos('pn', 'pronoun'), preference('en'))).toBe('Pronoun');
    expect(candidatePartOfSpeech(withPos('int', 'interjection'), preference('en'))).toBe('Interjection');
  });

  // Same first sense the card prints, so the chip and the card cannot disagree
  // about which word this is.
  it('follows the interface language, like the chips on the card', () => {
    expect(candidatePartOfSpeech(withPos('pn', 'pronoun'), preference('es'))).toBe('Pronombre');
  });

  it('is empty when the candidate has no part of speech to show', () => {
    expect(candidatePartOfSpeech({ ...WORD, entries: [] } as ShirabeWord, preference('en'))).toBe('');
    expect(candidatePartOfSpeech(null, preference('en'))).toBe('');
  });
});

/**
 * What the picker calls a candidate. The card's own headword is a different
 * question -- see `candidateName` for why they are deliberately not the same
 * expression.
 */
describe('candidateName', () => {
  const word = (headword: string, matchedHeadword?: string) =>
    ({ id: headword, headword, matchedHeadword }) as ShirabeWord;

  // The case it exists for. 彼方 is "usually written in kana" so it leads with
  // かなた, and it also reads あなた -- so a reader who tapped あなた was offered
  // a chip reading かなた, with nothing connecting the two.
  it('names a word by the spelling it shares with the reading that was matched', () => {
    expect(candidateName(word('かなた', '彼方'))).toBe('彼方');
  });

  it('leaves every ordinary word under its own headword', () => {
    expect(candidateName(word('猫'))).toBe('猫');
  });
});

/**
 * The bug a linked reader hit on every common word: their monolingual
 * dictionaries were fetched, parsed, and then dropped before rendering.
 *
 * A stack leads with JMdict and the monolinguals sit under it -- which is what
 * happens to anyone who adds one to a stack that already had JMdict. The sense
 * cap was applied to the flattened list, so JMdict's first six filled it and the
 * loop stopped before reaching the dictionaries the reader linked their account
 * to see. Nothing errored; the definitions were simply never printed.
 */
describe('cardSenses across a reader stack', () => {
  const stacked = (jmdictSenses: number) =>
    ({
      id: '猫-ねこ',
      headword: '猫',
      entries: [
        {
          dictionary: 'jmdict',
          senses: Array.from({ length: jmdictSenses }, (_, i) => ({
            definitions: [{ lang: 'en', text: `sense ${i + 1}` }],
            tags: [],
          })),
        },
        { dictionary: 'yomitan-abc', senses: [{ definitions: [{ lang: 'ja', text: 'ネコ科の動物' }], tags: [] }] },
      ],
    }) as unknown as ShirabeWord;

  it('reaches a monolingual dictionary under a JMdict entry longer than the cap', () => {
    const senses = cardSenses(stacked(8), preference('en'));

    expect(senses.map((sense) => sense.dictionary)).toContain('yomitan-abc');
  });

  // The cap still does its job -- one dictionary cannot fill the card -- it is
  // just counted per dictionary rather than over the flattened list.
  it('still caps how much of any one dictionary is printed', () => {
    const senses = cardSenses(stacked(20), preference('en'));

    expect(senses.filter((sense) => sense.dictionary === 'jmdict')).toHaveLength(6);
  });
});

// Each dictionary numbers its own senses. A running count would label
// 三省堂's first sense 34 on a card carrying nine dictionaries, which is a number
// about our rendering rather than about the word.
describe('sense numbering', () => {
  it('restarts at the top of each dictionary', () => {
    const word = {
      id: '死ぬ',
      headword: '死ぬ',
      entries: [
        {
          dictionary: 'jmdict',
          senses: [
            { definitions: [{ lang: 'en', text: 'to die' }], tags: [] },
            { definitions: [{ lang: 'en', text: 'to cease' }], tags: [] },
          ],
        },
        { dictionary: 'yomitan-abc', senses: [{ definitions: [{ lang: 'ja', text: '息が絶える' }], tags: [] }] },
      ],
    } as unknown as ShirabeWord;

    expect(cardSenses(word, preference('en')).map((sense) => [sense.dictionary, sense.number])).toEqual([
      ['jmdict', '①'],
      ['jmdict', '②'],
      ['yomitan-abc', '①'],
    ]);
  });

  /**
   * The tiers a dictionary actually used, which it does not state in the text.
   *
   * デジタル大辞泉 files 食べる as ① ② with ㋐ ㋑ UNDER ②. Rendered flat that is four
   * equal senses, which the dictionary does not say -- so the glyph carries the
   * tier and the row steps in under the sense it belongs to.
   */
  it('numbers and indents a sub-sense under its parent', () => {
    const tiered = {
      id: '食べる',
      headword: '食べる',
      entries: [
        {
          dictionary: 'デジタル大辞泉',
          senses: [
            { depth: 1, definitions: [{ lang: 'ja', text: '食物をかんで、のみこむ。' }], tags: [] },
            { depth: 1, definitions: [{ lang: 'ja', text: '暮らしを立てる。' }], tags: [] },
            { depth: 2, definitions: [{ lang: 'ja', text: '「食う」「飲む」の謙譲語。' }], tags: [] },
            { depth: 2, definitions: [{ lang: 'ja', text: '「食う」「飲む」を、へりくだる。' }], tags: [] },
          ],
        },
      ],
    } as unknown as ShirabeWord;

    expect(cardSenses(tiered, preference('en')).map((sense) => [sense.number, sense.indent])).toEqual([
      ['①', 0],
      ['②', 0],
      ['㋐', 1],
      ['㋑', 1],
    ]);
  });

  // A pack that heads its senses with 一 二 三 uses all three tiers, so its
  // senses step in under the group they belong to and the sub-senses again.
  it('steps everything in under a dictionary that numbers groups', () => {
    const grouped = {
      id: 'これ',
      headword: 'これ',
      entries: [
        {
          dictionary: '精選版　日本国語大辞典',
          senses: [
            { depth: 0, definitions: [{ lang: 'ja', text: '代名詞。' }], tags: [] },
            { depth: 1, definitions: [{ lang: 'ja', text: '話し手に近いもの。' }], tags: [] },
            { depth: 0, definitions: [{ lang: 'ja', text: '感動詞。' }], tags: [] },
            { depth: 1, definitions: [{ lang: 'ja', text: '呼びかけ。' }], tags: [] },
          ],
        },
      ],
    } as unknown as ShirabeWord;

    expect(cardSenses(grouped, preference('en')).map((sense) => [sense.number, sense.indent])).toEqual([
      ['1', 0],
      ['①', 1],
      ['2', 0],
      // The second group restarts its senses, rather than running on to ②.
      ['①', 1],
    ]);
  });

  // An older Shirabe sends no `depth` at all, and a flat list of plain senses is
  // what that has always meant.
  it('reads a sense with no depth as an ordinary one', () => {
    const flat = {
      id: '猫',
      headword: '猫',
      entries: [{ dictionary: 'jmdict', senses: [{ definitions: [{ lang: 'en', text: 'cat' }], tags: [] }] }],
    } as unknown as ShirabeWord;

    expect(cardSenses(flat, preference('en')).map((sense) => [sense.number, sense.indent])).toEqual([['①', 0]]);
  });
});
