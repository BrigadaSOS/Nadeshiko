import type { TranslationVisibilityMode } from '~/composables/useTranslationVisibility';
import { tagLabel, tagLanguage, type TagLanguage } from '~/utils/wordTagLabels';

/** Word-card response shapes and language selection, independent of tooltip layout. */

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
  /** Which TIER the dictionary put this sense at: 0 a group, 1 a sense, 2 a
   *  sub-sense of the one above. Absent from an older Shirabe, which reads as a
   *  flat list of plain senses. See `numberSenses`. */
  depth?: number;
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
  /** What that dictionary is CALLED. A slug is not a name: a reader's own
   *  uploads are filed under a hash of their contents, so attributing a sense by
   *  slug prints `yomitan-c89af12122021a8a` at the person who uploaded
   *  三省堂国語辞典. Absent from an older Shirabe, so the slug stays the fallback. */
  dictionaryName?: string;
  senses?: ShirabeSense[];
}

/**
 * Expression parts keep words hidden by a merged token reachable through the card; requested with
 * `include=parts`.
 */
export interface ShirabePart {
  text: string;
  lemma: string;
  reading?: string;
  /** Absent when the part resolves to no word: print it, do not link it. */
  id?: string;
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

/**
 * Only fields the card renders. Example sentences come from Nadeshiko's corpus rather than dictionary
 * examples.
 */
export interface ShirabeWord {
  id: string;
  headword: string;
  /**
   * What to CALL this word when its own headword is a kana form the reader never
   * typed, and absent for almost everything. See `candidateName`.
   *
   * A label. `id` and `headword` are what the word IS; this is only ever
   * rendered.
   */
  matchedHeadword?: string | null;
  parts?: ShirabePart[];
  /** Shirabe's own answer to "is this a person rather than a word". Never derive
   *  it from `dictionary`: JMdict carries ~7,300 JMnedict rows under its own
   *  slug, so a slug test keeps every one of them silently. */
  name?: boolean;
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
 * Identify candidates share the word-card shape. Each carries at most one dictionary entry, possibly none;
 * optional fields allow the same renderers to handle either response.
 */
export type ShirabeCandidate = ShirabeWord;

/**
 * Use the selected word consistently for the title, sentence search and Anki mining. The token is the
 * fallback before lookup or when no entry exists.
 */
export function cardHeadword(word: ShirabeWord | null, tokenDictForm: string | undefined): string {
  return word?.headword || tokenDictForm || '';
}

/**
 * `candidateName` uses `matchedHeadword` only in the picker. Card identity and ruby remain based on
 * `headword`, which also drives search and Anki mining.
 */
/**
 * Render ruby only when its segment texts concatenate to the headword; mismatched candidate ruby falls back
 * to plain text.
 */
/** A run of text with optional ruby over it. Mirrors the shape the token
 *  enrichment uses, so the card and the note draw from one idea of furigana. */
export interface FuriganaSegment {
  text: string;
  reading: string;
}

export function headwordFurigana(word: ShirabeWord | null): FuriganaSegment[] {
  const segments = (word?.furigana ?? []).filter((segment) => segment.text);
  if (segments.length === 0 || !word?.headword) return [];
  const spelled = segments.map((segment) => segment.text).join('');
  return spelled === word.headword ? segments.map((s) => ({ text: s.text, reading: s.ruby ?? '' })) : [];
}

export function candidateName(candidate: ShirabeCandidate): string {
  return candidate.matchedHeadword || candidate.headword;
}

/**
 * Distinguish a missing entry from an unavailable lookup so a request failure is not presented as a
 * dictionary verdict.
 */
/**
 * An all-name candidate list is a successful lookup, not a missing entry. Names are filtered only when
 * competing vocabulary exists.
 */
export type LookupState = 'shown' | 'name' | 'missing' | 'unavailable';

export function lookupState(
  candidates: number,
  reason: 'missing' | 'failed' | undefined,
  nameOnly = false,
): LookupState {
  if (candidates > 0) return nameOnly ? 'name' : 'shown';
  return reason === 'failed' ? 'unavailable' : 'missing';
}

/** One chip in the candidate picker, carrying the index it has in the FULL
 *  ranked list rather than in the row it is drawn in. */
export interface PickerChip {
  candidate: ShirabeCandidate;
  index: number;
}

/**
 * Cap the visible row, not the candidate list. Preserve full-list indices and keep the picked candidate
 * visible when collapsed; overflow remains reachable through the expanded list.
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

/** Show a capped list of distinct alternate spellings, excluding the headword and reading already printed. */
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

/** Translation preferences cover English and Spanish; other JMdict gloss languages are excluded. */
export type GlossLanguage = 'en' | 'es';

const GLOSS_LANGUAGES: readonly GlossLanguage[] = ['en', 'es'];

/**
 * Japanese definitions from the reader's own monolingual dictionary stack are printable outside the EN/ES
 * translation preferences.
 */
export type PrintLanguage = GlossLanguage | 'ja';

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
  /** Tag-chip language follows the interface locale, independently of the EN/ES gloss-label language. */
  tags: TagLanguage;
}

/**
 * Language visibility determines inclusion; the supplied language order determines priority. Spoiler
 * translations count as shown because opening the tooltip is deliberate.
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
 * Select languages client-side so one cached response serves different preferences. Local hides may fall back
 * to globally enabled languages, but global exclusions never return. If all enabled languages are hidden, no
 * translated gloss is shown.
 */
export function selectDefinitions(definitions: ShirabeText[] | undefined, preference: GlossPreference): ShirabeText[] {
  const wanted = preference.order.length > 0 ? inLanguages(definitions, preference.order) : [];
  if (wanted.length > 0) return wanted;

  const fallback = preference.order.length > 0 ? inLanguages(definitions, preference.fallback) : [];
  if (fallback.length > 0) return fallback;

  // Japanese monolingual definitions are an independent fallback because the reader added those dictionaries.
  // Other unsolicited gloss languages remain excluded.
  return inLanguages(definitions, ['ja']);
}

/** Definitions in the given languages, that order, keeping each language's own
 *  order within itself. Anything in a language not asked for is left out. */
function inLanguages(definitions: ShirabeText[] | undefined, langs: readonly PrintLanguage[]): ShirabeText[] {
  const source = definitions ?? [];
  return langs.flatMap((lang) => source.filter((definition) => definition.lang?.toLowerCase() === lang));
}

export interface CardGlossRow {
  lang: PrintLanguage;
  /** EN / ES, the same badge the segment translations use. EMPTY for Japanese,
   *  which needs no badge to say what it is -- see `GLOSS_LABEL`. Callers must
   *  render it conditionally rather than assuming a label is always there. */
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
  /** Which dictionary wrote this sense. Worth carrying since a reader who linked
   *  their Shirabe account can have several on one card, in their own order: a
   *  monolingual definition and a JMdict gloss sitting in one numbered list with
   *  nothing to tell them apart reads as one dictionary contradicting itself. */
  dictionary: string;
  /**
   * Stable dictionary identifier for stored mappings, separate from the display name. Optional for older
   * Shirabe responses; names may change or collide.
   */
  dictionarySlug?: string;
  /** What to PRINT as this sense's number: `1`, `①` or `㋐` depending on its
   *  tier, counted within its own dictionary. See `numberSenses`. */
  number: string;
  /** How far to step this sense in, in tiers: 0, 1 or 2. */
  indent: number;
}

/**
 * Badge EN/ES glosses to distinguish their shared script. Japanese needs no badge, but retains `lang: 'ja'`
 * as data.
 */
const GLOSS_LABEL: Record<PrintLanguage, string> = { en: 'EN', es: 'ES', ja: '' };

/** Group a sense's definitions into one badged row per language, keeping the
 *  reader's language order and each language's own sense order within its row. */
function glossRows(definitions: ShirabeText[]): CardGlossRow[] {
  const rows: CardGlossRow[] = [];
  for (const definition of definitions) {
    const lang = definition.lang?.toLowerCase() as PrintLanguage;
    if (lang !== 'en' && lang !== 'es' && lang !== 'ja') continue;
    const existing = rows.find((row) => row.lang === lang);
    if (existing) existing.text += `; ${definition.text}`;
    else rows.push({ lang, label: GLOSS_LABEL[lang], text: definition.text });
  }
  return rows;
}

const MISC_TAG_CATEGORIES = new Set(['misc', 'field', 'dialect']);

/**
 * Localize chips by stable JMdict code and deduplicate by printed label. Preserve Shirabe's full wording in
 * the tooltip.
 */
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

/** Cap senses per dictionary so a long entry cannot crowd out later dictionaries in the reader's stack. */
const SENSE_LIMIT = 6;

/** Whether two senses carry the same part of speech, by the labels that would be
 *  printed rather than by the codes behind them: `vs-i` and `vs-s` both read
 *  "Suru verb", and a reader cannot see the difference we would be preserving. */
function samePartsOfSpeech(a: CardTag[], b: CardTag[]): boolean {
  return a.length === b.length && a.every((chip, index) => chip.label === b[index]?.label);
}

/**
 * Keep dictionary order and a separate allowance per dictionary; omit senses with no printable gloss.
 * Suppress repeated POS chips, but retain usage qualifiers and notes on every sense they qualify.
 */
export function cardSenses(word: ShirabeWord | null, preference: GlossPreference, limit = SENSE_LIMIT): CardSense[] {
  // Entries arrive in the key owner's own dictionary order, so flattening keeps
  // it: a reader who put a monolingual dictionary above JMdict reads it first.
  const senses = (word?.entries ?? []).flatMap((entry) =>
    // Named, not slugged: what goes on screen above a group of senses is the
    // dictionary's name. The slug is the fallback for an older Shirabe, and is
    // what the card showed before this.
    (entry.senses ?? []).map((sense) => ({
      sense,
      dictionary: entry.dictionaryName || entry.dictionary,
      slug: entry.dictionary ?? '',
    })),
  );
  const cards: CardSense[] = [];
  // Compare against the last POS actually printed, not a previous row whose repeated chip was blanked.
  let shown: CardTag[] = [];

  // Apply quotas per dictionary; exhausting one must not stop later dictionaries.
  const printed = new Map<string, number>();
  const kept: Array<{ sense: ShirabeSense; dictionary: string }> = [];

  for (const { sense, dictionary, slug } of senses) {
    const glosses = glossRows(selectDefinitions(sense.definitions, preference));
    if (glosses.length === 0) continue;

    const key = dictionary ?? '';
    const used = printed.get(key) ?? 0;
    if (used >= limit) continue;
    printed.set(key, used + 1);
    kept.push({ sense, dictionary: key });

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
      dictionary,
      dictionarySlug: slug,
      // Placeholders: the numbers depend on the whole run of senses a dictionary
      // kept, which is not known until the loop has finished.
      number: '',
      indent: 0,
    });
  }

  return numberSenses(cards, kept);
}

/**
 * Group by stable slug when available, otherwise by name for older responses. Resolve the fallback per sense
 * so mixed-version stacks remain usable.
 */
export function dictionaryKey(sense: Pick<CardSense, 'dictionary' | 'dictionarySlug'>): string {
  return sense.dictionarySlug || sense.dictionary;
}

/** ①-⑳ ㉑-㉟ ㊱-㊿ is every circled numeral Unicode has, and ㋐-㋾ every circled
 *  kana. A dictionary that runs past the end of either falls back to plain
 *  digits rather than to a glyph nobody can read as "fifty-one". Mirrors
 *  `SearchHelper::CIRCLED` on the Shirabe side. */
const CIRCLED = [...range(0x2460, 0x2473), ...range(0x3251, 0x325f), ...range(0x32b1, 0x32bf)];
const CIRCLED_KANA = range(0x32d0, 0x32fe);

function range(from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) => String.fromCodePoint(from + i));
}

/**
 * Number each dictionary by depth: groups use digits, senses circled numbers, sub-senses circled kana. Reset
 * child counters under a new parent; omit the unused group indentation for flat dictionaries. Mirrors
 * Shirabe's sense numbering.
 */
function numberSenses(cards: CardSense[], kept: Array<{ sense: ShirabeSense; dictionary: string }>): CardSense[] {
  const tieredDictionaries = new Set(
    kept.filter((entry) => depthOf(entry.sense) === 0).map((entry) => entry.dictionary),
  );
  const counts = new Map<string, [number, number, number]>();

  return cards.map((card, index) => {
    const source = kept[index];
    const depth = depthOf(source?.sense);
    const key = source?.dictionary ?? '';
    const tally = counts.get(key) ?? [0, 0, 0];

    // A group resets the senses under it; a sense resets its own sub-senses.
    // Same three counters as `SearchHelper#number_tiers`.
    if (depth === 0) {
      tally[0] += 1;
      tally[1] = 0;
      tally[2] = 0;
    } else if (depth === 1) {
      tally[1] += 1;
      tally[2] = 0;
    } else {
      tally[2] += 1;
    }
    counts.set(key, tally);

    const ordinal = tally[depth];
    const tiered = tieredDictionaries.has(key);
    return {
      ...card,
      number: tierNumber(depth, ordinal),
      indent: tiered ? depth : Math.max(depth - 1, 0),
    };
  });
}

function depthOf(sense: ShirabeSense | undefined): 0 | 1 | 2 {
  const depth = sense?.depth;
  return depth === 0 || depth === 2 ? depth : 1;
}

function tierNumber(depth: number, ordinal: number): string {
  if (depth === 0) return String(ordinal);
  if (depth === 1) return CIRCLED[ordinal - 1] ?? String(ordinal);
  return CIRCLED_KANA[ordinal - 1] ?? String(ordinal);
}

/**
 * Preview the first printable gloss through `cardSenses` so candidate summaries use the same
 * language-selection rules as the open card.
 */
export function candidateSummary(
  candidate: ShirabeCandidate | null,
  preference: GlossPreference,
  limit = SUMMARY_LIMIT,
): string {
  const [first] = cardSenses(candidate, preference, 1);
  const text = first?.glosses[0]?.text ?? '';
  if (text.length <= limit) return text;

  // Cut on a word boundary where there is one within reach, so a truncated
  // English gloss does not end mid-word; Japanese has none to find and falls
  // through to the hard cut.
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit - 12 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Long enough for a short gloss whole ("individual; separate"), short enough
 *  that a row stays one line at the card's 340px. */
const SUMMARY_LIMIT = 42;

/**
 * Use the first printable sense's POS to distinguish candidates with identical spellings, consistently with
 * the card.
 */
export function candidatePartOfSpeech(candidate: ShirabeCandidate | null, preference: GlossPreference): string {
  const [first] = cardSenses(candidate, preference, 1);
  return first?.partsOfSpeech[0]?.label ?? '';
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
/**
 * Classify pitch from downstep and mora count; the same downstep can be odaka or nakadaka depending on
 * reading length. Names feed pitch-category Anki fields; numeric positions are separate.
 */
export function pitchCategory(reading: string, downstep: number): string {
  if (!Number.isInteger(downstep) || downstep < 0) return '';
  if (downstep === 0) return 'heiban';
  if (downstep === 1) return 'atamadaka';
  // Reuse `pitchMorae` so category and diagram use the same reading segmentation.
  const morae = pitchMorae(reading, downstep).length;
  if (morae > 0 && downstep >= morae) return 'odaka';
  return 'nakadaka';
}

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
 * Outbound surface recorded as `utm_content`; word-card and Anki-definition links share a destination but
 * represent different entry points.
 */
export type ShirabeLinkSurface = 'word-card' | 'kanji-chip' | 'anki-definition';

/**
 * Use standard UTM parameters for Shirabe attribution because `noreferrer` strips the referrer. Keep that
 * privacy boundary: the originating URL can contain the reader's search.
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
 * Use the freshly resolved lookup id for word links, never a stored token id: content-derived ids can change
 * after dictionary re-imports.
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
