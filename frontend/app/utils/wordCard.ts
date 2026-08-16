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

/** A piece of text Shirabe tagged with the language it is written in, which is
 *  the shape every definition arrives in. */
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
  /** Usage notes ("usu. in kana", "after the -te form of a verb"). The part of a
   *  sense that changes how a word is USED rather than what it means, so a
   *  definition read without it can be understood correctly and still used
   *  wrongly. Absent when the sense has none. */
  notes?: string[];
}

export interface ShirabeEntry {
  dictionary: string;
  senses?: ShirabeSense[];
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
 *  (forms, siblings, cross references, loanword sources, example sentences);
 *  reading a narrow shape here keeps the tooltip from quietly depending on the
 *  rest of it. Examples are deliberately not among them -- Nadeshiko's own
 *  corpus is what this site is for, and "More sentences" below the card goes
 *  there rather than to a dictionary's handful. */
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
  /** Every spelling the word is written with. What answers the reader who met
   *  空く and is being shown 開く. */
  forms?: Array<{ text: string; script?: string; common?: boolean }>;
  entries?: ShirabeEntry[];
  /** The dictionary's own id for this word, and the dictionary it belongs to.
   *  Only `POST /words/identify` carries the pair; the detail response does not,
   *  which is why merging a candidate under a detail keeps it. Worth holding on
   *  to: `id` is a handle derived from dictionary content and moves when a
   *  headword or a resolution rule moves, while this pair survives a re-import. */
  sourceId?: string;
  dictionary?: string;
}

/**
 * One word a token COULD be, as `POST /api/v1/words/identify` ranks them.
 *
 * A strict subset of `ShirabeWord`, and typed as one on purpose: a candidate
 * carries `id`, `headword`, `reading`, `common` and its own single-entry
 * definition, but none of `furigana`, `jlpt`, `frequency` or `pitch`. Those come
 * from `GET /words/{id}` afterwards, and the card renders the two spread
 * together -- so there is one card shape rather than two, and `cardSenses`,
 * `minedWord` and `infoHtml` never learn which half they are looking at.
 *
 * The RESPONSE carries many of these; each one carries at most one entry. A
 * candidate names a single dictionary record (`serialize_candidate` builds
 * `entries` as a one-element array), and that array is empty when the record
 * had no sense worth serializing -- so a candidate with no definitions at all is
 * a real answer. `cardSenses` flat-maps over `entries`, so none and one both
 * render without a special case.
 */
export type ShirabeCandidate = ShirabeWord;

/**
 * The word an open card is ABOUT.
 *
 * One expression, because three separate things name it and they must not
 * disagree: the headword at the top, what "More sentences" searches the corpus
 * for, and what Anki is asked about and mines into. They did disagree -- the
 * card offered candidates and the reader could pick 黄身, but the search and the
 * Anki probe both went on reading the token, so picking changed the definitions
 * and nothing else. A card claiming "you already have this word" about one word
 * while its button writes another is worse than not offering the choice.
 *
 * The token is the FALLBACK rather than the source, and that ordering is the
 * whole of it. It answers before the lookup lands and when there is no entry at
 * all, which is what lets the Anki probe start the moment the card opens instead
 * of waiting on a dictionary call it does not depend on -- and what empties it
 * when the card closes and there is neither.
 */
export function cardHeadword(word: ShirabeWord | null, tokenDictForm: string | undefined): string {
  return word?.headword || tokenDictForm || '';
}

/**
 * What the card should say about a lookup, given how it came back.
 *
 * Three answers, and the difference between the last two is the whole reason
 * this is not a boolean. "There is no entry" is a fact about the WORD -- a name,
 * a coinage, a spelling the corpus preserved -- and it is the end of the search,
 * so the card says it. "We could not ask" is a fact about US, and printing it as
 * the dictionary's verdict would be a lie about a word that may well be in
 * there.
 *
 * What that reasoning did NOT justify is saying nothing at all, which is what
 * happened: a dictionary that would not answer left the card showing a headword
 * over blank space, indistinguishable from one still loading. Shirabe being down
 * is not the reader's fault and not a mystery worth making them solve, so it now
 * has its own state and its own words.
 */
export type LookupState = 'shown' | 'missing' | 'unavailable';

export function lookupState(candidates: number, reason: 'missing' | 'failed' | undefined): LookupState {
  if (candidates > 0) return 'shown';
  return reason === 'failed' ? 'unavailable' : 'missing';
}

/** One chip in the candidate picker, carrying the index it has in the FULL
 *  ranked list rather than in the row it is drawn in. */
export interface PickerChip {
  candidate: ShirabeCandidate;
  index: number;
}

/**
 * Which candidates the picker draws.
 *
 * Not a cap on the ANSWER: every candidate stays reachable and Shirabe ranks
 * rather than filters on purpose. It is a cap on the ROW, because a ranked list
 * is not automatically a readable one -- きみ answers twelve, six of them
 * JMnedict entries all glossing "Kimi", and twelve chips wrap into four lines on
 * a 340px card and push the definitions off the bottom.
 *
 * The index travels WITH the candidate, which is the whole reason this is a
 * function rather than a `slice` at the call site. Once the row is trimmed, its
 * own loop index and the position in the full list stop agreeing, and the pick
 * addresses the full list. Reading the loop index selects the wrong word the
 * moment anything is held back -- silently, because both are small integers and
 * one of them is usually right.
 *
 * A picked candidate is always in the row: pick from the expanded row, collapse
 * it again, and the card must not be left showing a word whose chip has gone.
 */
export function pickerChips(
  candidates: readonly ShirabeCandidate[],
  picked: number,
  expanded: boolean,
  limit: number,
): PickerChip[] {
  const all = candidates.map((candidate, index) => ({ candidate, index }));
  if (expanded || all.length <= limit) return all;

  const head = all.slice(0, limit);
  if (!head.some((chip) => chip.index === picked)) {
    const chosen = all[picked];
    if (chosen) head[head.length - 1] = chosen;
  }
  return head;
}

/**
 * The other spellings worth showing, and never the one already on the card.
 *
 * A reader who met 空く and is being shown 開く needs the two connected, and the
 * forms list is what does it. But it also carries the headword itself and the
 * kana reading, both of which are already on the card an inch above -- printing
 * them again spends the row on things the reader can see.
 *
 * Capped, because a word can carry a dozen rare spellings and this is a
 * supporting row rather than the point of the card.
 */
export function cardForms(word: ShirabeWord | null, limit = 4): string[] {
  const headword = word?.headword ?? '';
  const reading = word?.reading ?? '';
  const seen = new Set([headword, reading]);
  const forms: string[] = [];

  for (const form of word?.forms ?? []) {
    const text = form.text?.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    forms.push(text);
    if (forms.length === limit) break;
  }
  return forms;
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
  /** Globally enabled languages that a local search visibility choice hid.
   *  They are a last-resort dictionary fallback; globally excluded languages
   *  never return through this door. */
  fallback: GlossLanguage[];
  /** The one language Shirabe resolves part-of-speech and misc labels into
   *  (`?locale=`). Never empty: a card whose labels are in nobody's language
   *  helps nobody, so this falls back to the reader's own. */
  labels: GlossLanguage;
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
  languageOrder: readonly GlossLanguage[] = homeFirst(uiLocale === 'es' ? 'es' : 'en'),
): GlossPreference {
  // Spanish for a Spanish reader; English for everyone else, including the
  // Japanese interface, because English is the language JMdict is written in
  // and the one every entry is most likely to have.
  const home: GlossLanguage = uiLocale === 'es' ? 'es' : 'en';
  // The saved global choice decides which dictionary languages matter and in
  // what order. The search control can still hide one on that surface.
  const enabled = languageOrder.filter((lang): lang is GlossLanguage => GLOSS_LANGUAGES.includes(lang));
  const order = enabled.filter((lang) => modes[lang] !== 'hidden');
  return {
    order,
    fallback: enabled.filter((lang) => !order.includes(lang)),
    labels: order[0] ?? home,
    tags: tagLanguage(uiLocale),
  };
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
 * A search-local hide does not make a language globally irrelevant. A reader
 * who reads only Spanish on that surface still meets words JMdict has no
 * Spanish gloss for, so it may fall back to another globally enabled language.
 *
 * A globally excluded language is never used as a fallback: that choice means
 * the reader does not care about it anywhere. When every globally enabled
 * language is hidden, the card gets no definitions at all.
 */
export function selectDefinitions(definitions: ShirabeText[] | undefined, preference: GlossPreference): ShirabeText[] {
  if (preference.order.length === 0) return [];

  const wanted = inLanguages(definitions, preference.order);
  if (wanted.length > 0) return wanted;
  return inLanguages(definitions, preference.fallback);
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
  /** The sense's usage notes, verbatim. Empty when it has none. */
  notes: string[];
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
      // Not deduped against the sense above the way the part of speech is: a
      // note qualifies the sense it sits on, and carrying one down would state
      // something false about the next.
      notes: (sense.notes ?? []).filter((note) => note.trim().length > 0),
    });
    if (cards.length === limit) break;
  }

  return cards;
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

/**
 * Which link on the card a reader took to Shirabe. Rides out as `utm_content`,
 * so the two can be told apart on the other side: a reader who opens the kanji
 * chips is doing something different from one who wants the full entry, and
 * lumping them together hides which half of the card is doing the work.
 *
 * `anki-definition` is the same destination as `word-card` -- the word's own
 * page -- reached from a note rather than from the hover card, so it is a
 * different surface even though the path is the same.
 */
export type ShirabeLinkSurface = 'word-card' | 'kanji-chip' | 'anki-definition';

/**
 * Mark a Shirabe link as ours, so its own PostHog can attribute the visit.
 *
 * Not redundant with the referrer: every one of these links is rendered
 * `rel="noopener noreferrer"`, which strips the `Referer` header outright, so
 * without this Shirabe records the whole of Nadeshiko's outbound traffic as
 * direct. `noreferrer` is not worth dropping to fix that -- these are
 * third-party destinations reached from a page that knows what the reader
 * searched for, and the query string is in the URL.
 *
 * `utm_*` rather than a parameter of our own because Shirabe runs stock
 * posthog-js, which reads these five names and no others: they land on the event
 * AND on the person as `$initial_utm_source`, so a reader who arrives once from
 * here stays attributed. Nothing has to be built on the Shirabe side.
 */
function withAttribution(url: string, surface: ShirabeLinkSurface): string {
  const params = new URLSearchParams({
    utm_source: 'nadeshiko',
    // The visit is an onward click from a link on someone else's site, which is
    // what `referral` means in the convention posthog-js follows.
    utm_medium: 'referral',
    utm_content: surface,
  });
  return `${url}?${params}`;
}

/**
 * The word's own page on Shirabe.
 *
 * `id` is the one the LOOKUP RESPONSE came back with, never one off a stored
 * token. The id is derived from dictionary content, so it moves when a headword,
 * a commonness flag or a resolution rule moves -- linking with what was just
 * resolved keeps the link right, while linking with something stored months ago
 * lands on the wrong entry without ever looking broken.
 */
export function shirabeWordUrl(
  id: string,
  locale: GlossLanguage,
  surface: Extract<ShirabeLinkSurface, 'word-card' | 'anki-definition'> = 'word-card',
): string {
  return withAttribution(`${SHIRABE_SITE}/${locale}/word/${encodeURIComponent(id)}`, surface);
}

export function shirabeKanjiUrl(character: string, locale: GlossLanguage): string {
  return withAttribution(`${SHIRABE_SITE}/${locale}/kanji/${encodeURIComponent(character)}`, 'kanji-chip');
}
