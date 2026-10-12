import { furiganaNotation, type EnrichedToken, type FuriganaSegment } from '~/utils/tokenEnrichment';
import {
  type CardSense,
  type GlossPreference,
  type ShirabeWord,
  cardSenses,
  dictionaryKey,
  headwordFurigana,
  pitchCategory,
  pitchMorae,
  shirabeWordUrl,
} from '~/utils/wordCard';

/**
 * Pure word-card rendering for Anki fields. Inline styles work without note-type setup; classes allow
 * customization. Do not embed a stylesheet in each field, which would duplicate it across notes and prevent
 * central customization.
 */

/** The `nd-` prefix Nadeshiko already uses for its own DOM ids, so a class
 *  landing in someone's note type cannot collide with the card template they
 *  wrote themselves. */
const CLASS = 'nd';

/**
 * Anki's editor does not apply note-type Styling, so fields need inline styles. Keep classes for
 * customization through `ANKI_CARD_CSS`, whose `!important` rules override them. Use explicit colors for
 * older Qt WebEngine compatibility.
 */
const STYLE = {
  // `list-style:none` and no gutter: the number is printed into the row below,
  // so it can carry the dictionary's own tier (① / ㋐) instead of a counter that
  // only knows how to count.
  senses: 'margin:6px 0 0;padding-left:0;list-style:none;text-align:left;',
  sense: 'margin:5px 0;line-height:1.45;',
  // The number column. Inline because Anki strips stylesheets, and in `em` so it
  // follows whatever font size the reader's note type sets. The sub-sense step
  // is the same measure, applied per row in `definitionHtml`.
  senseNumber: 'display:inline-block;min-width:1.4em;color:#9a9a9a;',
  // Name dictionary groups so a mined note retains attribution without the hover card's context.
  dictionaryName: 'margin:8px 0 2px;font-size:11px;color:#9a9a9a;',
  // `display:block` is the single most load-bearing declaration here: without it
  // the EN and ES glosses run together on one line, which is the "ground
  // crewESmecánico" in the report.
  gloss: 'display:block;margin-top:2px;',
  glossLang:
    'display:inline-block;min-width:1.55rem;margin-right:6px;padding:1px 4px;' +
    'border:1px solid rgba(128,128,128,0.4);border-radius:4px;' +
    'font-size:9px;font-weight:600;letter-spacing:0.03em;text-align:center;',
  // Keep the pitch diagram unbroken with `nowrap`; inline-block morae preserve the padding used to draw the
  // overline.
  pitch: 'display:inline-block;white-space:nowrap;',
  mora: 'display:inline-block;padding:1px 0;line-height:1.4;border-top:2px solid transparent;',
  downstep: 'margin-left:5px;font-size:11px;color:#9a9a9a;',
  badges: 'display:inline-flex;flex-wrap:wrap;gap:4px;',
  badge:
    'display:inline-block;padding:1px 7px;border-radius:999px;' +
    'background:rgba(128,128,128,0.18);font-size:11px;font-weight:600;line-height:1.5;white-space:nowrap;',
  // Hung off the numbered list rather than woven into a sense: it is a way
  // back to the word, not another gloss, and a reader styling `.nd-senses`
  // should not have to carve it out.
  source: 'margin:8px 0 0;font-size:12px;line-height:1.4;',
  sourceLink: 'color:#6b7280;',
} as const;

/**
 * A chip, coloured by what it is.
 *
 * The on-screen card colours a part of speech differently from a usage
 * qualifier, so that "Military" never reads as a grammatical category, and the
 * note has to make the same distinction or it loses information the card was
 * carrying. `category` is JMdict's own, already resolved by `cardSenses`.
 */
const CHIP_COLOR: Record<string, string> = {
  pos: '#f472b6',
  field: '#60a5fa',
  dialect: '#a78bfa',
};
const CHIP_FALLBACK = '#9ca3af';

function chipStyle(color: string): string {
  return (
    `display:inline-block;margin:0 4px 3px 0;padding:0 6px;border-radius:999px;` +
    `font-size:10px;font-weight:600;line-height:16px;white-space:nowrap;` +
    `color:${color};border:1px solid ${color}42;background:${color}1f;`
  );
}

/**
 * Optional customization stylesheet; `!important` overrides field-level inline styles. Keep selectors flat
 * because clipboard copying strips HTML-like text, and use Anki's `.night_mode` class rather than an OS media
 * query.
 */
export const ANKI_CARD_CSS = `/* Nadeshiko word fields */
.nd-senses { margin: 6px 0 0 !important; padding-left: 18px !important; list-style: decimal !important; text-align: left !important; }
.nd-sense { margin: 5px 0 !important; line-height: 1.45 !important; }
.nd-sense::marker { color: #9a9a9a !important; }
.nd-pos, .nd-tag { display: inline-block !important; margin: 0 4px 3px 0 !important; padding: 0 6px !important; border: 1px solid rgba(0, 0, 0, 0.18) !important; border-radius: 999px !important; font-size: 10px !important; font-weight: 600 !important; line-height: 16px !important; white-space: nowrap !important; }
.nd-pos { color: #be185d !important; background: rgba(190, 24, 93, 0.08) !important; }
.nd-tag { color: #6b7280 !important; background: rgba(107, 114, 128, 0.1) !important; }
.nd-gloss { display: block !important; }
.nd-gloss-lang { display: inline-block !important; min-width: 1.55rem !important; margin-right: 6px !important; padding: 1px 4px !important; border: 1px solid rgba(0, 0, 0, 0.2) !important; border-radius: 4px !important; font-size: 9px !important; font-weight: 600 !important; letter-spacing: 0.03em !important; color: #6b7280 !important; }
.nd-pitch { display: inline-block !important; white-space: nowrap !important; }
.nd-mora { display: inline-block !important; padding: 1px 0 !important; line-height: 1.4 !important; border-top: 2px solid transparent !important; }
.nd-mora--high { border-top-color: #db2777 !important; }
.nd-mora--drop { border-right: 2px solid #db2777 !important; }
.nd-downstep { margin-left: 5px !important; font-size: 11px !important; color: #9a9a9a !important; }
.nd-badges { display: inline-flex !important; flex-wrap: wrap !important; gap: 4px !important; }
.nd-target { background: rgba(244, 114, 182, 0.22) !important; border-radius: 3px !important; padding: 0 2px !important; }
.nd-badge { padding: 1px 7px !important; border-radius: 999px !important; background: #eceff3 !important; color: #4b5563 !important; font-size: 11px !important; font-weight: 600 !important; line-height: 1.5 !important; white-space: nowrap !important; }
.nd-source { margin: 8px 0 0 !important; font-size: 12px !important; line-height: 1.4 !important; }
.nd-source-link { color: #6b7280 !important; }

.night_mode .nd-sense::marker, .night_mode .nd-downstep { color: #8a8a8a !important; }
.night_mode .nd-pos { color: #f472b6 !important; background: rgba(244, 114, 182, 0.12) !important; border-color: rgba(255, 255, 255, 0.22) !important; }
.night_mode .nd-tag { color: #b3b3b3 !important; background: rgba(255, 255, 255, 0.08) !important; border-color: rgba(255, 255, 255, 0.22) !important; }
.night_mode .nd-gloss-lang { color: #a5a5a5 !important; border-color: rgba(255, 255, 255, 0.25) !important; }
.night_mode .nd-mora--high { border-top-color: #f472b6 !important; }
.night_mode .nd-mora--drop { border-right-color: #f472b6 !important; }
.night_mode .nd-badge { background: #303030 !important; color: #cfcfcf !important; }
.night_mode .nd-source-link { color: #a5a5a5 !important; }
`;

/** Escape third-party dictionary text at the HTML-field boundary; Anki stores and renders fields as HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Everything a mine can write about the open word. Every field is a finished
 *  string: the store substitutes, it does not format. */
export interface MinedWord {
  /** The dictionary form, plain. */
  word: string;
  /** Kana, plain. Empty when the headword is already kana. */
  reading: string;
  /** `手加減[てかげん]`, Anki's own ruby notation. */
  furigana: string;
  /** Rendered senses from the selected dictionary stack, or empty when no readable definition remains. */
  definition: string;
  /** Number of dictionaries explicitly picked, for export analytics only; not written to a note field. */
  pickedDictionaries: number;
  /** Plain corpus-rank digits for numeric sorting, separate from the card's `#155` badge. */
  frequency: string;
  /** The JLPT level the dictionary files the word under, `N3`. */
  jlpt: string;
  /**
   * The accent patterns by name -- heiban, atamadaka, nakadaka, odaka -- one per
   * recorded accent. The category is what a reader recognises; the downstep in
   * `{word-pitch-num}` is what a template computes with.
   */
  pitchCategories: string;
  /**
   * First dictionary in the selected stack, following the reader's priority order without requiring a stored
   * slug mapping.
   */
  definitionFirst: string;
  /**
   * Rendered definitions keyed by stable dictionary slug for `{definition:<slug>}` mappings. Dictionaries
   * with no matching senses have no key.
   */
  definitionsByDictionary: Record<string, string>;
  /** Mora diagram for the first accent pattern, or '' when there is none. */
  pitch: string;
  /**
   * Comma-separated downsteps as plain text. Templates parsing numeric pitch fields must not encounter digits
   * from diagram HTML or inline styles.
   */
  pitchPositions: string;
  /** Common / JLPT / frequency chips, or '' when the word has none. */
  info: string;
  /** Finished sentence HTML with the mined token marked; empty when there is no sentence. */
  sentenceHighlight: string;
  /** The pitch-accent clip to upload, or null when no pattern has a recording. */
  audioUrl: string | null;
  /** What to call that clip in the collection. Null exactly when `audioUrl` is. */
  audioFilename: string | null;
}

/** Shared empty selection avoids a fresh default identity on every hover recomputation. */
const EMPTY_PICK: ReadonlySet<string> = new Set<string>();

const EMPTY: MinedWord = {
  word: '',
  reading: '',
  furigana: '',
  definition: '',
  definitionFirst: '',
  pickedDictionaries: 0,
  definitionsByDictionary: {},
  pitch: '',
  info: '',
  pitchPositions: '',
  frequency: '',
  jlpt: '',
  pitchCategories: '',
  sentenceHighlight: '',
  audioUrl: null,
  audioFilename: null,
};

/**
 * Mark the token by its offsets, not a substring search. Require `text.slice(b, e) === token.s`; rebased or
 * stale offsets that do not match return the plain escaped sentence.
 */
export function highlightedSentence(text: string, token: EnrichedToken | null): string {
  if (!text) return '';
  const plain = `<div>${escapeHtml(text)}</div>`;
  if (!token?.s) return plain;

  const { b, e, s: surface } = token;
  if (!Number.isInteger(b) || !Number.isInteger(e) || b < 0 || e > text.length || b >= e) return plain;
  if (text.slice(b, e) !== surface) return plain;

  // Use conventional `<b>` markup without forced colors so existing Anki templates style the target. Keep
  // `.nd-target` as a customization hook.
  const mark = `<b class="${CLASS}-target">${escapeHtml(surface)}</b>`;

  return `<div>${escapeHtml(text.slice(0, b))}${mark}${escapeHtml(text.slice(e))}</div>`;
}

/**
 * Separate POS and usage-qualifier classes preserve the card's distinction and allow independent note
 * styling.
 */
function chips(sense: CardSense): string {
  const render = (chip: { label: string; title: string; category?: string }, className: string, color: string) =>
    `<span class="${CLASS}-${className}" style="${chipStyle(color)}" title="${escapeHtml(chip.title)}">` +
    `${escapeHtml(chip.label)}</span>`;

  const parts = sense.partsOfSpeech.map((chip) => render(chip, 'pos', CHIP_COLOR.pos ?? CHIP_FALLBACK));
  const tags = sense.tags.map((chip) =>
    render(chip, `tag ${CLASS}-tag--${chip.category}`, CHIP_COLOR[chip.category] ?? CHIP_FALLBACK),
  );
  return [...parts, ...tags].join('');
}

/**
 * Render the senses already selected by `cardSenses`; language choice, fallback, numbering and quotas stay
 * shared with the on-screen card.
 */

export function definitionHtml(senses: CardSense[]): string {
  if (senses.length === 0) return '';

  // Named only when the note carries more than one, exactly as on the card:
  // repeating one dictionary's name down its own senses is the noise this avoids.
  const named = new Set(senses.map((sense) => sense.dictionary)).size > 1;

  const items = senses.flatMap((sense, index) => {
    const label = chips(sense);
    const glosses = sense.glosses
      .map((row) => {
        // Japanese carries no badge (`GLOSS_LABEL`), and an empty one would be a
        // stray box of padding down every row of a monolingual note.
        const lang = row.label
          ? `<span class="${CLASS}-gloss-lang" style="${STYLE.glossLang}">${escapeHtml(row.label)}</span>`
          : '';
        return `<span class="${CLASS}-gloss" style="${STYLE.gloss}">${lang}${escapeHtml(row.text)}</span>`;
      })
      .join('');

    const indent = sense.indent > 0 ? `padding-left:${1.4 * sense.indent}em;` : '';
    const number = `<span class="${CLASS}-sense-number" style="${STYLE.senseNumber}">${escapeHtml(sense.number)}</span>`;
    const row = `<li class="${CLASS}-sense" style="${STYLE.sense}${indent}">${number}${label}${glosses}</li>`;

    const heading =
      named && sense.dictionary !== senses[index - 1]?.dictionary
        ? `<li class="${CLASS}-dictionary" style="${STYLE.dictionaryName}">${escapeHtml(sense.dictionary)}</li>`
        : '';

    return heading ? [heading, row] : [row];
  });

  return `<ol class="${CLASS}-senses" style="${STYLE.senses}">${items.join('')}</ol>`;
}

/**
 * Link directly to the resolved word, not a new homograph search. Append only beside a nonempty definition:
 * an empty field tells the store to preserve existing content.
 */
export function definitionSourceHtml(word: ShirabeWord, locale: GlossPreference['labels']): string {
  if (!word.id) return '';
  const href = escapeHtml(shirabeWordUrl(word.id, locale, 'anki-definition'));
  return (
    `<div class="${CLASS}-source" style="${STYLE.source}">` +
    `<a class="${CLASS}-source-link" href="${href}" style="${STYLE.sourceLink}">View on shirabe.org</a>` +
    `</div>`
  );
}

/**
 * Draw pitch borders on each mora so the diagram follows the note template's font and line height. The drop
 * class closes the overline at the last high mora.
 */
export function pitchHtml(reading: string, downstep: number): string {
  const morae = pitchMorae(reading, downstep);
  if (morae.length === 0) return '';

  const cells = morae
    .map((mora) => {
      const modifiers = [mora.high ? `${CLASS}-mora--high` : '', mora.drop ? `${CLASS}-mora--drop` : '']
        .filter(Boolean)
        .join(' ');
      const className = modifiers ? `${CLASS}-mora ${modifiers}` : `${CLASS}-mora`;
      // The overline is drawn per mora, so the colour has to ride on each cell
      // rather than on the row: this is the diagram, not decoration around it.
      const style =
        STYLE.mora +
        (mora.high ? 'border-top-color:#db2777;' : '') +
        (mora.drop ? 'border-right:2px solid #db2777;' : '');
      return `<span class="${className}" style="${style}">${escapeHtml(mora.text)}</span>`;
    })
    .join('');

  return (
    `<span class="${CLASS}-pitch" style="${STYLE.pitch}">${cells}` +
    `<span class="${CLASS}-downstep" style="${STYLE.downstep}">[${downstep}]</span></span>`
  );
}

/** Common / JLPT / frequency, the card's badge row. Frequency is printed the way
 *  the card prints it, `#1234`, because the bare number reads as a count. */
export function infoHtml(word: ShirabeWord): string {
  const badges: string[] = [];
  if (word.common) badges.push('Common');
  if (word.jlpt) badges.push(word.jlpt);
  if (typeof word.frequency === 'number') badges.push(`#${word.frequency}`);
  if (badges.length === 0) return '';

  const cells = badges
    .map((text) => `<span class="${CLASS}-badge" style="${STYLE.badge}">${escapeHtml(text)}</span>`)
    .join('');
  return `<span class="${CLASS}-badges" style="${STYLE.badges}">${cells}</span>`;
}

/**
 * Choose the first accent with a recording, not necessarily the first listed pattern; audio coverage is per
 * clip.
 */
function recordedPitch(word: ShirabeWord): { downstep: number; audioUrl: string } | null {
  for (const pattern of word.pitch ?? []) {
    if (pattern.audioUrl) return { downstep: pattern.downstep, audioUrl: pattern.audioUrl };
  }
  return null;
}

/**
 * Key audio filenames by sanitized reading and accent, not the mutable word id. Stable names let Anki
 * overwrite repeated uploads rather than accumulate duplicate clips.
 */
export function pitchAudioFilename(reading: string, downstep: number, url: string): string {
  const safe = reading.replace(/[^\p{Script=Hiragana}\p{Script=Katakana}a-zA-Z0-9ー]/gu, '') || 'word';
  // From the URL's own path, so an OGG stays an OGG. A query string is not part
  // of the name, and anything that does not look like an extension falls back
  // rather than becoming one.
  const extension = /\.([a-z0-9]{2,4})(?:$|[?#])/i.exec(url)?.[1]?.toLowerCase() ?? 'mp3';
  return `nadeshiko-word-${safe}-${downstep}.${extension}`;
}

/** Shirabe's headword ruby in the shape the furigana renderer takes. A word with
 *  no alignment renders bare, exactly as a token with no `f` does. */
function headwordSegments(word: ShirabeWord): FuriganaSegment[] {
  // Apply the card's ruby/headword alignment guard before writing Anki furigana.
  const furigana = headwordFurigana(word);
  if (furigana.length === 0) return [{ text: word.headword, reading: '' }];
  return furigana;
}

/**
 * Use token headword and reading as fallback when lookup is absent. Dictionary-only fields stay empty so the
 * store preserves existing note content.
 * @param picked Dictionary keys to retain; an empty selection means all dictionaries.
 */
export function minedWord(
  word: ShirabeWord | null,
  token: EnrichedToken | null,
  preference: GlossPreference,
  sentenceText = '',
  picked: ReadonlySet<string> = EMPTY_PICK,
): MinedWord {
  if (!word && !token) return EMPTY;

  const headword = word?.headword || token?.dictForm || '';
  const reading = word?.reading || token?.readingHiragana || '';

  if (!word) {
    return {
      ...EMPTY,
      word: headword,
      reading: reading === headword ? '' : reading,
      furigana: furiganaNotation([{ text: headword, reading: '' }]),
      // Marked even when the dictionary had nothing: which word the reader was
      // asking about does not depend on the lookup having answered.
      sentenceHighlight: highlightedSentence(sentenceText, token),
    };
  }

  const recorded = recordedPitch(word);
  const accent = word.pitch?.[0];
  // Select senses once through `cardSenses`; attach source links only to nonempty definitions so missing
  // content does not overwrite an existing glossary.
  const everything = cardSenses(word, preference);
  /**
   * A selection narrows every definition field. Key it by dictionary identity, not row position, so language
   * changes and sense renumbering cannot select different content.
   */
  const all = picked.size === 0 ? everything : everything.filter((sense) => picked.has(dictionaryKey(sense)));
  const senses = definitionHtml(all);

  // Group the selected senses after `cardSenses` so named-dictionary fields share the card's language rules,
  // POS suppression and quotas.
  const byDictionary: Record<string, CardSense[]> = {};
  for (const sense of all) {
    const slug = sense.dictionarySlug;
    if (!slug) continue;
    if (!byDictionary[slug]) byDictionary[slug] = [];
    byDictionary[slug].push(sense);
  }
  const definitionsByDictionary: Record<string, string> = {};
  for (const [slug, group] of Object.entries(byDictionary)) {
    const html = definitionHtml(group);
    if (html) definitionsByDictionary[slug] = html;
  }

  // The first surviving dictionary follows stack order. Group definitionFirst by display name, rather
  // than slug, so older responses without slugs remain supported.
  const firstDictionary = all[0]?.dictionary;
  const firstSenses =
    firstDictionary === undefined ? '' : definitionHtml(all.filter((sense) => sense.dictionary === firstDictionary));

  return {
    word: headword,
    // A kana headword is its own reading, and printing it in both fields is a
    // card that says the same thing twice. Same rule the tooltip applies.
    reading: reading === headword ? '' : reading,
    furigana: furiganaNotation(headwordSegments(word)),
    definition: senses ? `${senses}${definitionSourceHtml(word, preference.labels)}` : '',
    // Add source links to standalone definition fields, but not each named-dictionary field, to avoid
    // duplicate links.
    definitionFirst: firstSenses ? `${firstSenses}${definitionSourceHtml(word, preference.labels)}` : '',
    definitionsByDictionary,
    pickedDictionaries: picked.size,
    // Count morae from the dictionary reading, not an inflected token reading.
    pitch: word.reading && accent ? pitchHtml(word.reading, accent.downstep) : '',
    // Every accent the dictionary lists, not just the one drawn above: the
    // number is cheap and a reader checking a second reading wants both.
    pitchPositions: (word.pitch ?? [])
      .map((pattern) => pattern.downstep)
      .filter((downstep) => Number.isInteger(downstep))
      .join(', '),
    // Rank zero is valid; test the type rather than truthiness.
    frequency: typeof word.frequency === 'number' ? String(word.frequency) : '',
    jlpt: word.jlpt ?? '',
    pitchCategories: (word.pitch ?? [])
      .map((pattern) => pitchCategory(word.reading ?? headword, pattern.downstep))
      .filter((name) => name !== '')
      .join(', '),
    info: infoHtml(word),
    sentenceHighlight: highlightedSentence(sentenceText, token),
    audioUrl: recorded?.audioUrl ?? null,
    audioFilename: recorded ? pitchAudioFilename(word.reading ?? headword, recorded.downstep, recorded.audioUrl) : null,
  };
}
