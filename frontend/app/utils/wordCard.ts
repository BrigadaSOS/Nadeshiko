import type { TranslationVisibilityMode } from '~/composables/useTranslationVisibility';
import { tagLabel, tagLanguage, type TagLanguage } from '~/utils/wordTagLabels';

/**
 * The word card behind a hovered token: what Shirabe returns for it, and the
 * shaping the tooltip does before printing it.
 *
 * The shaping lives here rather than in the component because the interesting
 * part is a decision, not a layout: which language a definition is worth showing
 * in. That is testable on its own, and it is the part that goes quietly wrong.
 */

/** A piece of text Shirabe tagged with the language it is written in. Both a
 *  definition and an example-sentence translation arrive in this shape. */
export interface ShirabeText {
  lang: string;
  text: string;
}

export interface ShirabeTag {
  category: string;
  code: string;
  label: string;
}

export interface ShirabeSense {
  position?: number;
  definitions?: ShirabeText[];
  tags?: ShirabeTag[];
}

export interface ShirabeEntry {
  dictionary: string;
  senses?: ShirabeSense[];
}

/** One word of an example sentence, as Shirabe parsed it. */
export interface ShirabeExampleToken {
  surface: string;
  /** The dictionary form. What a search should go looking for, because 注意された
   *  turns up far less of the corpus than する does. */
  lemma?: string;
  /** False for punctuation and grammar, which nobody looks up. */
  content: boolean;
  /** The word the card is about, wherever it turns up in this sentence,
   *  compounds included. */
  matched: boolean;
}

export interface ShirabeExample {
  japanese: string;
  translations?: ShirabeText[];
  /** Absent on an answer cached before Shirabe started tokenizing examples, and
   *  then `japanese` is all there is to print. */
  tokens?: ShirabeExampleToken[];
}

export interface ShirabePitch {
  downstep: number;
  pattern?: string;
  /** A pre-generated clip of the reading spoken at this accent, on Shirabe's
   *  public CDN. Null when that (reading, accent) was never generated: coverage
   *  is per clip and lights up batch by batch, so a word can have a pitch
   *  pattern and no recording of it. */
  audioUrl?: string | null;
}

/** Only what the card renders. `GET /v1/words/{id}` carries a good deal more
 *  (forms, siblings, cross references, loanword sources); reading a narrow shape
 *  here keeps the tooltip from quietly depending on the rest of it. */
export interface ShirabeWord {
  id: string;
  headword: string;
  reading?: string | null;
  common?: boolean;
  jlpt?: string | null;
  frequency?: number | null;
  pitch?: ShirabePitch[];
  /** Ruby for the headword, aligned by Shirabe against the dictionary. */
  furigana?: Array<{ text: string; ruby?: string }>;
  entries?: ShirabeEntry[];
  examples?: ShirabeExample[];
}

/**
 * The languages a definition can be shown in here.
 *
 * JMdict ships more than these (French, German, Russian, Dutch), and Shirabe
 * returns every one an entry has. Nadeshiko has a reader preference for exactly
 * two, though, and a French gloss handed to a reader who asked for neither is
 * noise, so anything outside this list is dropped rather than guessed at.
 */
export type GlossLanguage = 'en' | 'es';

const GLOSS_LANGUAGES: readonly GlossLanguage[] = ['en', 'es'];

export interface GlossPreference {
  /** Definition languages the reader has not hidden, their own language first.
   *  Empty when they have hidden every one. */
  order: GlossLanguage[];
  /** The one language Shirabe resolves part-of-speech and misc labels into
   *  (`?locale=`). Never empty: a card whose labels are in nobody's language
   *  helps nobody, so this falls back to the reader's own. */
  labels: GlossLanguage;
  /** How each language is shown, straight off the reader's preference. A
   *  definition only cares whether a language is on the list at all, but an
   *  example translation renders as its own row and has to know whether that
   *  row is plain or a spoiler. */
  modes: Record<GlossLanguage, TranslationVisibilityMode>;
  /** The language the part-of-speech and misc chips are written in: the
   *  INTERFACE language, not the gloss one. A chip is a label the product puts
   *  on a word, the way "More sentences" below it is, and it is the one thing on
   *  this card that can be said in Japanese -- no dictionary writes definitions
   *  in Japanese, so `labels` above can never be 'ja' and a reader on the
   *  Japanese interface would otherwise never see a Japanese word here. */
  tags: TagLanguage;
}

/**
 * What the reader reads, which is not what the interface is in.
 *
 * The UI language and the translation language are separate settings: someone
 * reads the site in English and studies from Spanish glosses, or the other way
 * round. The interface language only decides the ORDER here (your own language
 * first); the visibility preference decides who is on the list at all.
 *
 * 'spoiler' counts as shown. It means "make me try first" on a translation
 * sitting next to the Japanese, and a tooltip is something the reader opened on
 * purpose: they have already decided to look.
 */
export function glossPreference(
  uiLocale: string,
  modes: Record<GlossLanguage, TranslationVisibilityMode>,
): GlossPreference {
  // Spanish for a Spanish reader; English for everyone else, including the
  // Japanese interface, because English is the language JMdict is written in
  // and the one every entry is most likely to have.
  const home: GlossLanguage = uiLocale === 'es' ? 'es' : 'en';
  const order = homeFirst(home).filter((lang) => modes[lang] !== 'hidden');
  return { order, labels: order[0] ?? home, modes, tags: tagLanguage(uiLocale) };
}

function homeFirst(home: GlossLanguage): GlossLanguage[] {
  return [home, ...GLOSS_LANGUAGES.filter((lang) => lang !== home)];
}

/**
 * The definitions to print, filtered and ordered by what the reader reads.
 *
 * Shirabe returns every language the entry has, each tagged, and deliberately
 * does not choose. Choosing here rather than in the request is what lets ONE
 * cached response serve a reader with both languages on and a reader with one
 * off, and it is why the request is only keyed by the label language.
 *
 * The fallback is the part that matters. A reader who reads only Spanish still
 * meets words JMdict has no Spanish gloss for, and an empty card teaches
 * nothing while an English gloss teaches the word: so a sense with nothing in
 * the wanted languages falls back to the one that was turned off.
 *
 * A reader who hid BOTH gets nothing, and that is not the same case. Nothing is
 * missing there: they asked for no translations, and the rest of the card (the
 * word, its reading, what the form is doing, its kanji) still answers. Falling
 * back would hand the strictest possible preference MORE text than hiding one
 * language does, and the segment translations beside it already render none.
 */
export function selectDefinitions(definitions: ShirabeText[] | undefined, preference: GlossPreference): ShirabeText[] {
  if (preference.order.length === 0) return [];

  const wanted = inLanguages(definitions, preference.order);
  if (wanted.length > 0) return wanted;
  return inLanguages(
    definitions,
    homeFirst(preference.labels).filter((lang) => !preference.order.includes(lang)),
  );
}

/** Definitions in the given languages, that order, keeping each language's own
 *  order within itself. Anything in a language not asked for is left out. */
function inLanguages(definitions: ShirabeText[] | undefined, langs: readonly GlossLanguage[]): ShirabeText[] {
  const source = definitions ?? [];
  return langs.flatMap((lang) => source.filter((definition) => definition.lang?.toLowerCase() === lang));
}

export interface CardGlossRow {
  lang: GlossLanguage;
  /** EN / ES, the same badge the segment translations use. */
  label: string;
  text: string;
}

export interface CardTag {
  /** The short label to print on the chip ("Noun"). */
  label: string;
  /** JMdict's own wording, kept for the chip's tooltip ("noun (common)
   *  (futsuumeishi)"). Nothing is lost by shortening the chip: the full text is
   *  a hover away. */
  title: string;
  /** JMdict tag category, so a usage qualifier never reads as a part of speech. */
  category: string;
}

export interface CardSense {
  /** Learner-facing labels off the entry ("Ichidan verb"): what the word IS,
   *  not what this occurrence of it is doing. */
  partsOfSpeech: CardTag[];
  /** Misc, field, and dialect labels ("usually written using kana alone"). */
  tags: CardTag[];
  /** One row per language, badged. Joining the two into one line read as a
   *  single definition that happened to change language halfway through. */
  glosses: CardGlossRow[];
}

const GLOSS_LABEL: Record<GlossLanguage, string> = { en: 'EN', es: 'ES' };

/** Group a sense's definitions into one badged row per language, keeping the
 *  reader's language order and each language's own sense order within its row. */
function glossRows(definitions: ShirabeText[]): CardGlossRow[] {
  const rows: CardGlossRow[] = [];
  for (const definition of definitions) {
    const lang = definition.lang?.toLowerCase() as GlossLanguage;
    if (lang !== 'en' && lang !== 'es') continue;
    const existing = rows.find((row) => row.lang === lang);
    if (existing) existing.text += `; ${definition.text}`;
    else rows.push({ lang, label: GLOSS_LABEL[lang], text: definition.text });
  }
  return rows;
}

const MISC_TAG_CATEGORIES = new Set(['misc', 'field', 'dialect']);

/** Chips for one sense, deduped by the label that will be printed: JMdict often
 *  carries several codes that shorten to the same word (`vs-i` and `vs-s` both
 *  read "Suru verb"), and printing it twice is the duplication this replaces.
 *
 *  The wording comes from `~/utils/wordTagLabels`, keyed off JMdict's stable tag
 *  *code* rather than the label Shirabe sent: JMdict's own is verbose and
 *  inconsistent ("n" arrives as "noun (common) (futsuumeishi)", which reads as
 *  three tags rather than one), and it is English whatever locale we ask for.
 *  The full JMdict wording survives as the chip's tooltip. */
function cardTags(tags: ShirabeTag[], lang: TagLanguage, keep: (tag: ShirabeTag) => boolean): CardTag[] {
  const chips: CardTag[] = [];
  for (const tag of tags) {
    if (!keep(tag)) continue;
    const label = tagLabel(tag.category, tag.code, tag.label, lang);
    if (chips.some((chip) => chip.label === label)) continue;
    chips.push({ label, title: tag.label, category: tag.category });
  }
  return chips;
}

const SENSE_LIMIT = 6;

/** Whether two senses carry the same part of speech, by the labels that would be
 *  printed rather than by the codes behind them: `vs-i` and `vs-s` both read
 *  "Suru verb", and a reader cannot see the difference we would be preserving. */
function samePartsOfSpeech(a: CardTag[], b: CardTag[]): boolean {
  return a.length === b.length && a.every((chip, index) => chip.label === b[index]?.label);
}

/**
 * The numbered senses to print. A sense left with no gloss the reader can read
 * drops out rather than printing its labels over an empty line.
 *
 * A sense whose part of speech is the same as the sense above it prints no POS
 * chip at all. 顔 is a noun in all six of its senses, and repeating "Noun" six
 * times down a 340px card is six chips that say nothing new -- the reader reads
 * the first one and then has to look past the rest to reach the definitions. A
 * blank means "same as above", which is how a paper dictionary has always
 * carried a part of speech down a numbered list.
 *
 * Only the POS. Usage qualifiers stay on every sense they belong to: "usually
 * kana" on sense 3 and not on sense 4 is a real difference between those two
 * senses, and carrying it down would state something false.
 *
 * This is a deliberate divergence from Shirabe, which prints the chip on every
 * sense (`_word_body.html.erb`). Its word page has the width to spend and this
 * card does not. Owner intends to make the same change there (2026-08-10), at
 * which point the two agree again.
 */
export function cardSenses(word: ShirabeWord | null, preference: GlossPreference, limit = SENSE_LIMIT): CardSense[] {
  const senses = (word?.entries ?? []).flatMap((entry) => entry.senses ?? []);
  const cards: CardSense[] = [];
  // The last POS actually printed, which is not the same as the previous card's
  // own: once a repeat is blanked, the next sense still has to be compared
  // against the chip the reader can SEE, or an A / A / A run would print the
  // first and third.
  let shown: CardTag[] = [];

  for (const sense of senses) {
    const glosses = glossRows(selectDefinitions(sense.definitions, preference));
    if (glosses.length === 0) continue;

    const tags = sense.tags ?? [];
    const partsOfSpeech = cardTags(tags, preference.tags, (tag) => tag.category === 'partOfSpeech');
    const repeated = samePartsOfSpeech(partsOfSpeech, shown);
    if (!repeated) shown = partsOfSpeech;

    cards.push({
      partsOfSpeech: repeated ? [] : partsOfSpeech,
      tags: cardTags(tags, preference.tags, (tag) => MISC_TAG_CATEGORIES.has(tag.category)),
      glosses,
    });
    if (cards.length === limit) break;
  }

  return cards;
}

export interface CardExampleToken {
  text: string;
  /** What clicking this word searches Nadeshiko for: the dictionary form when
   *  Shirabe knew one, else the surface. Null for punctuation and grammar,
   *  which print as plain text because a search for 、 answers nothing. */
  query: string | null;
  matched: boolean;
}

/** An example sentence split into the words a reader can click. Empty for a
 *  sentence Shirabe sent no tokens for, and then it prints as it came. */
export function exampleTokens(example: ShirabeExample): CardExampleToken[] {
  return (example.tokens ?? []).map((token) => ({
    text: token.surface,
    query: token.content ? token.lemma || token.surface : null,
    matched: token.matched,
  }));
}

/** A translation of an example, as one of the badged rows the segment card
 *  prints its own translations in. */
export interface CardTranslationRow {
  lang: GlossLanguage;
  /** The badge to the left of the text, worded as the segment rows word it. */
  label: string;
  /** 'spoiler' is covered until the reader asks for it. 'hidden' never reaches
   *  here: a hidden language has no row. */
  mode: 'show' | 'spoiler';
  text: string;
}

const TRANSLATION_LABEL: Record<GlossLanguage, string> = { en: 'EN', es: 'ES' };

/**
 * One row per language this sentence is translated into and the reader has not
 * hidden, their own language first.
 *
 * No fallback here, unlike a definition. A sense with no gloss the reader can
 * read is a hole in the card, so it borrows the language they turned off; a
 * sentence is already printed in Japanese above the row, and the reader who hid
 * English asked not to be shown English. The segment translations under the
 * card obey the preference exactly, and a card that argued with them would only
 * look broken.
 */
export function translationRows(
  translations: ShirabeText[] | undefined,
  preference: GlossPreference,
): CardTranslationRow[] {
  const rows: CardTranslationRow[] = [];

  for (const lang of preference.order) {
    const text = (translations ?? []).find((translation) => translation.lang?.toLowerCase() === lang)?.text;
    if (!text) continue;
    rows.push({
      lang,
      label: TRANSLATION_LABEL[lang],
      mode: preference.modes[lang] === 'spoiler' ? 'spoiler' : 'show',
      text,
    });
  }

  return rows;
}

export interface CardExample {
  japanese: string;
  tokens: CardExampleToken[];
  translations: CardTranslationRow[];
}

const EXAMPLE_LIMIT = 2;

/** A couple of example sentences, each split into clickable words and translated
 *  into the languages the reader reads. Translated ones go first: an
 *  untranslated sentence is still worth showing, but not at the cost of one we
 *  can translate. */
export function cardExamples(
  word: ShirabeWord | null,
  preference: GlossPreference,
  limit = EXAMPLE_LIMIT,
): CardExample[] {
  const examples = (word?.examples ?? []).map((example) => ({
    japanese: example.japanese,
    tokens: exampleTokens(example),
    translations: translationRows(example.translations, preference),
  }));

  return [
    ...examples.filter((example) => example.translations.length > 0),
    ...examples.filter((example) => example.translations.length === 0),
  ].slice(0, limit);
}

/** Each distinct kanji in a headword, in the order it is written. */
export function kanjiIn(headword: string): string[] {
  return [...new Set([...headword].filter((character) => /\p{Script=Han}/u.test(character)))];
}

export interface PitchMora {
  text: string;
  high: boolean;
  /** The mora the pitch falls after: the last high one before the drop. */
  drop: boolean;
}

const SMALL_KANA = 'ゃゅょャュョぁぃぅぇぉァィゥェォ';

/**
 * The reading split into morae, each marked high or low for one accent pattern.
 * Heiban (downstep 0) rises after the first mora and stays up; atamadaka (1) is
 * high on the first mora only; anything else is high from the second mora to the
 * downstep. Mirrors Shirabe's own pitch diagram.
 */
export function pitchMorae(reading: string, downstep: number): PitchMora[] {
  const morae: string[] = [];
  for (const character of reading) {
    const previous = morae[morae.length - 1];
    if (previous !== undefined && SMALL_KANA.includes(character)) morae[morae.length - 1] = previous + character;
    else morae.push(character);
  }

  const high = (index: number) =>
    downstep === 0 ? index > 0 : downstep === 1 ? index === 0 : index > 0 && index < downstep;

  return morae.map((text, index) => ({ text, high: high(index), drop: high(index) && !high(index + 1) }));
}

const SHIRABE_SITE = 'https://shirabe.org';

/** The word's own page on Shirabe. `wid` is the slug Shirabe stamped the token
 *  with, so there is nothing to reconstruct and no homograph to guess at. */
export function shirabeWordUrl(wid: string, locale: GlossLanguage): string {
  return `${SHIRABE_SITE}/${locale}/word/${encodeURIComponent(wid)}`;
}

export function shirabeKanjiUrl(character: string, locale: GlossLanguage): string {
  return `${SHIRABE_SITE}/${locale}/kanji/${encodeURIComponent(character)}`;
}
