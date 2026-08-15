import { furiganaNotation, type EnrichedToken, type FuriganaSegment } from '~/utils/tokenEnrichment';
import {
  cardSenses,
  pitchMorae,
  shirabeWordUrl,
  type CardSense,
  type GlossPreference,
  type ShirabeWord,
} from '~/utils/wordCard';

/**
 * The word card, rendered for an Anki note.
 *
 * Kept out of the store that sends it for the reason `ankiMining` is: what goes
 * wrong here is silent. A gloss that lands escaped twice, a pitch diagram whose
 * overline covers the wrong morae, a headword whose furigana bracket swallows
 * the okurigana -- none of it throws, and all of it is only ever seen weeks
 * later on a review card. Rendering is a pure function of the lookup, so it can
 * be read against expected strings without a running Anki.
 *
 * The markup carries both inline styles and classes: inline so it looks right
 * the moment it lands, classes so a reader can still take the look over. See
 * `STYLE` for why the classes alone were not enough, and `ANKI_CARD_CSS` for
 * what pasting the stylesheet is now for.
 *
 * What is still deliberately absent is a `<style>` BLOCK inside a field. That
 * would be duplicated onto every note ever mined and re-parsed by Anki's editor
 * each time one was opened, and the reader could never change it without editing
 * every note they own.
 */

/** The `nd-` prefix Nadeshiko already uses for its own DOM ids, so a class
 *  landing in someone's note type cannot collide with the card template they
 *  wrote themselves. */
const CLASS = 'nd';

/**
 * The look of the word card, as inline `style` attributes.
 *
 * Classes alone were the original design and they do not survive contact with
 * Anki. Anki's EDITOR does not apply the note type's Styling at all -- it is
 * where a reader looks at what was just mined, and there the classed markup
 * rendered as one unbroken run of text: "NounMilitaryENmaintenance engineer;
 * ground crewESmecánico...". The reviewer only styled it if the reader had gone
 * and pasted a stylesheet first, so the common case was a wall of prose in both
 * places.
 *
 * Inline wins everywhere and needs no setup: the editor, the reviewer, AnkiWeb
 * and AnkiMobile all render a `style` attribute, and none of them need the
 * stylesheet to have been found and pasted. It is what Yomitan emits, which is
 * also what these notes sit beside.
 *
 * The classes stay on the markup, so a reader who wants their own look can still
 * target `.nd-*` -- see `ANKI_CARD_CSS`, which is offered with `!important` for
 * exactly that reason, since an inline style outranks a stylesheet otherwise.
 *
 * Colours are written out rather than composed with `color-mix` as the on-screen
 * card does: Anki's Qt WebEngine trails browsers by a good margin, and a colour
 * function it does not know leaves the chip with no background at all.
 */
const STYLE = {
  senses: 'margin:6px 0 0;padding-left:18px;list-style:decimal;text-align:left;',
  sense: 'margin:5px 0;line-height:1.45;',
  // `display:block` is the single most load-bearing declaration here: without it
  // the EN and ES glosses run together on one line, which is the "ground
  // crewESmecánico" in the report.
  gloss: 'display:block;margin-top:2px;',
  glossLang:
    'display:inline-block;min-width:1.55rem;margin-right:6px;padding:1px 4px;' +
    'border:1px solid rgba(128,128,128,0.4);border-radius:4px;' +
    'font-size:9px;font-weight:600;letter-spacing:0.03em;text-align:center;',
  // `nowrap`, because a pitch diagram is one unit. This was briefly plain
  // `inline` so a long reading could wrap instead of overflowing a narrow
  // screen, and that was the wrong trade: the morae are separate boxes, so
  // wrapping breaks the reading MID-WORD and takes the overline with it --
  // `にいちゃ` on one line and `ん` on the next, with the stroke ending in the
  // middle of nowhere. An overhanging diagram is legible; a bisected one is not.
  // `inline-block` on the morae keeps the vertical padding the overline is drawn
  // against, which a plain inline box would ignore.
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
 * An OPTIONAL stylesheet, for a reader who wants a different look.
 *
 * Not needed to make the fields render -- they carry their own inline styles and
 * arrive looking like the word card. This is the escape hatch: paste it, edit
 * it, and the note follows your colours instead of ours.
 *
 * Every declaration is `!important`, which is the only thing that beats an
 * inline `style` attribute. Without it this sheet would paste cleanly and change
 * nothing, which is a worse experience than not offering it.
 *
 * Lives beside the renderers rather than in the settings component because it is
 * the other half of them: a class renamed in one and not the other is a card
 * that silently loses its formatting, and keeping the two in one file is what
 * makes that a diff anyone can see.
 *
 * Written flat, with no child combinators. `copyToClipboard` strips HTML from
 * what it copies, and a `>` in a selector is close enough to a tag to be worth
 * not finding out about. Anki's own `.night_mode` carries the dark variants --
 * a media query would not fire, since Anki switches theme by class rather than
 * by asking the OS.
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

/**
 * Text from the dictionary, safe to put in an HTML field.
 *
 * Glosses and tag labels are third-party strings: JMdict carries `&` in ordinary
 * definitions ("salt & pepper"), and an unescaped one is at best mojibake and at
 * worst swallows the rest of the field. Anki stores fields as HTML and renders
 * them as HTML, so this is the boundary where it has to happen.
 */
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
  /** Numbered senses, or '' when the dictionary had nothing the reader reads. */
  definition: string;
  /** Mora diagram for the first accent pattern, or '' when there is none. */
  pitch: string;
  /**
   * The downstep numbers alone, comma separated: `3`, or `0, 3` for a word with
   * two accepted accents.
   *
   * Its own field because a note type may want the number rather than the
   * picture, and because handing it the picture instead goes wrong in a way
   * nobody would guess: card templates that parse their pitch field for digits
   * read the ones inside our inline styles -- `1px`, `1.4`, `#db2777` -- and
   * print `1・0・4・2・2777` as though the word had five accents. Plain text
   * cannot be misread that way.
   */
  pitchPositions: string;
  /** Common / JLPT / frequency chips, or '' when the word has none. */
  info: string;
  /**
   * The sentence with the mined word marked, or '' when there is nothing to
   * mark.
   *
   * A finished string like the rest, so the store still only substitutes. It
   * describes the open word as much as the fields above do -- it is the answer
   * to "which of these is the one I looked up", which is the question a reader
   * has when the card comes back weeks later and the sentence is fifteen words
   * long.
   */
  sentenceHighlight: string;
  /** The pitch-accent clip to upload, or null when no pattern has a recording. */
  audioUrl: string | null;
  /** What to call that clip in the collection. Null exactly when `audioUrl` is. */
  audioFilename: string | null;
}

const EMPTY: MinedWord = {
  word: '',
  reading: '',
  furigana: '',
  definition: '',
  pitch: '',
  info: '',
  pitchPositions: '',
  sentenceHighlight: '',
  audioUrl: null,
  audioFilename: null,
};

/**
 * The sentence, with the mined word marked.
 *
 * Sliced by the token's own offsets rather than by searching for the word,
 * because a search finds the wrong one: 手 appears inside 手負い and 相手 alike,
 * and an inflected token's surface is not its dictionary form at all. The
 * invariant this leans on -- `content.slice(token.b, token.e) === token.s` -- is
 * asserted in `segmentConcatenation.test.ts` and is what makes the slice exact
 * rather than approximate.
 *
 * Verified before use, and that check is the whole safety of it: an expansion
 * re-bases these offsets, so a token addressing a different string than the one
 * passed here would otherwise cut the sentence in the wrong place and ship a
 * mangled field. When it does not line up the sentence comes back plain, which
 * is what it was before this existed.
 */
export function highlightedSentence(text: string, token: EnrichedToken | null): string {
  if (!text) return '';
  const plain = `<div>${escapeHtml(text)}</div>`;
  if (!token?.s) return plain;

  const { b, e, s: surface } = token;
  if (!Number.isInteger(b) || !Number.isInteger(e) || b < 0 || e > text.length || b >= e) return plain;
  if (text.slice(b, e) !== surface) return plain;

  // `<b>`, which is what every other miner puts round the target word -- Yomitan
  // marks its cloze the same way -- so a note type that already styles the word
  // inside its sentence field styles ours without being told about us.
  //
  // No inline style on this one, unlike the fields above. Bold is a thing Anki's
  // editor and every card template render on their own, so there is nothing here
  // that needs forcing, and forcing a colour would fight whatever the reader's
  // template already does with it. `.nd-target` is left on for anyone who wants
  // to add their own; `ANKI_CARD_CSS` carries a rule for it.
  const mark = `<b class="${CLASS}-target">${escapeHtml(surface)}</b>`;

  return `<div>${escapeHtml(text.slice(0, b))}${mark}${escapeHtml(text.slice(e))}</div>`;
}

/**
 * One sense's chips. Parts of speech and usage qualifiers are rendered as
 * separate classes rather than one chip type, because they answer different
 * questions -- what the word IS, versus what this sense of it is doing -- and a
 * reader styling their own card will want to tell them apart, which is the
 * distinction `cardSenses` already preserves.
 */
function chips(sense: CardSense): string {
  const render = (chip: { label: string; title: string; category?: string }, className: string, color: string) =>
    `<span class="${CLASS}-${className}" style="${chipStyle(color)}" title="${escapeHtml(chip.title)}">` +
    `${escapeHtml(chip.label)}</span>`;

  const parts = sense.partsOfSpeech.map((chip) => render(chip, 'pos', CHIP_COLOR.pos!));
  const tags = sense.tags.map((chip) =>
    render(chip, `tag ${CLASS}-tag--${chip.category}`, CHIP_COLOR[chip.category] ?? CHIP_FALLBACK),
  );
  return [...parts, ...tags].join('');
}

/**
 * The definitions, numbered, as the card prints them.
 *
 * `cardSenses` does the deciding -- which languages the reader reads and in what
 * order, the fallback when their languages have no gloss, the blanking of a part
 * of speech repeated from the sense above, the six-sense cap -- so the note and
 * the card cannot drift: they are the same list rendered twice. Passing the
 * reader's own `GlossPreference` is what makes a Spanish reader's card land in
 * Spanish without this function knowing that is what it did.
 */
export function definitionHtml(senses: CardSense[]): string {
  if (senses.length === 0) return '';

  const items = senses.map((sense) => {
    const label = chips(sense);
    const glosses = sense.glosses
      .map(
        (row) =>
          `<span class="${CLASS}-gloss" style="${STYLE.gloss}">` +
          `<span class="${CLASS}-gloss-lang" style="${STYLE.glossLang}">${escapeHtml(row.label)}</span>` +
          `${escapeHtml(row.text)}</span>`,
      )
      .join('');
    return `<li class="${CLASS}-sense" style="${STYLE.sense}">${label}${glosses}</li>`;
  });

  return `<ol class="${CLASS}-senses" style="${STYLE.senses}">${items.join('')}</ol>`;
}

/**
 * A way back to the word on Shirabe, hung under the numbered senses.
 *
 * Anki cards outlive the hover they were mined from, and without this the
 * definition is a copy with nowhere to go to look the word up again -- no
 * "More sentences", no full entry, no other dictionaries. The word page, not
 * a search: the lookup already picked the homograph, and a search would ask
 * the same question a second time.
 *
 * Only appended when there is a definition to hang it from. An empty
 * definition is the signal the store leaves the field alone on, so a lone
 * link must not become the field -- it would blank a glossary Yomitan wrote.
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
 * The mora diagram for one accent pattern, plus the downstep it is numbered by.
 *
 * The overline is drawn with borders on the morae themselves rather than as a
 * separate line, which is what the card does and the only thing that survives a
 * card template with a font the reader chose: an absolutely positioned rule
 * would sit wherever Anki's line height put it. `--drop` marks the last high
 * mora so the stylesheet can close the overline there.
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
 * The accent to record, which is the first one that HAS a recording.
 *
 * Not simply the first pattern. Coverage is per clip and lights up batch by
 * batch, so a word can carry two patterns with a recording of only the second --
 * and taking the first would leave the audio field empty on a word we can in
 * fact pronounce. The first is still preferred where both exist: it is the one
 * the card shows first and the more common reading.
 */
function recordedPitch(word: ShirabeWord): { downstep: number; audioUrl: string } | null {
  for (const pattern of word.pitch ?? []) {
    if (pattern.audioUrl) return { downstep: pattern.downstep, audioUrl: pattern.audioUrl };
  }
  return null;
}

/**
 * A filename for the clip, stable across mines of the same word.
 *
 * Stable so that mining a word twice does not leave two copies of the same
 * second of audio in the collection -- Anki keys media by name, so the second
 * store overwrites rather than accumulates. Keyed by reading and accent rather
 * than by the word id: the id is derived from dictionary content and moves when
 * a headword or a commonness flag moves (see `shirabeWordUrl`), which would
 * quietly orphan the old file and re-upload the identical clip under a new name.
 *
 * Everything outside kana, Latin alphanumerics and the separators is dropped, so
 * a reading that somehow carries a slash or a quote cannot escape into the path.
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
  const furigana = word.furigana ?? [];
  if (furigana.length === 0) return [{ text: word.headword, reading: '' }];
  return furigana.map((segment) => ({
    text: segment.text,
    reading: segment.ruby ?? '',
  }));
}

/**
 * Everything the open card knows about the word, rendered.
 *
 * The token is the fallback throughout rather than the source: a lookup that
 * failed or found nothing still leaves the reader looking at a headword and a
 * reading the parse gave them, and mining the sentence with those two filled in
 * beats mining it with a blank front. Only the dictionary's own content --
 * definitions, pitch, badges -- has no fallback, because there is nothing to
 * fall back TO and an empty string is what tells the store to leave the field
 * alone.
 */
export function minedWord(
  word: ShirabeWord | null,
  token: EnrichedToken | null,
  preference: GlossPreference,
  sentenceText = '',
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
  // The source link rides with the senses so a field mapped to `{definition}`
  // always has a way back to the word. Hung on only when there is a
  // definition: an empty string is what tells the store to leave the field
  // alone, and a lone link would count as content.
  const senses = definitionHtml(cardSenses(word, preference));

  return {
    word: headword,
    // A kana headword is its own reading, and printing it in both fields is a
    // card that says the same thing twice. Same rule the tooltip applies.
    reading: reading === headword ? '' : reading,
    furigana: furiganaNotation(headwordSegments(word)),
    definition: senses ? `${senses}${definitionSourceHtml(word, preference.labels)}` : '',
    // The reading the diagram is drawn over is the DICTIONARY's, not the token's:
    // morae are counted off it, and counting them off an inflected reading would
    // put the downstep in the wrong place.
    pitch: word.reading && accent ? pitchHtml(word.reading, accent.downstep) : '',
    // Every accent the dictionary lists, not just the one drawn above: the
    // number is cheap and a reader checking a second reading wants both.
    pitchPositions: (word.pitch ?? [])
      .map((pattern) => pattern.downstep)
      .filter((downstep) => Number.isInteger(downstep))
      .join(', '),
    info: infoHtml(word),
    sentenceHighlight: highlightedSentence(sentenceText, token),
    audioUrl: recorded?.audioUrl ?? null,
    audioFilename: recorded ? pitchAudioFilename(word.reading ?? headword, recorded.downstep, recorded.audioUrl) : null,
  };
}
