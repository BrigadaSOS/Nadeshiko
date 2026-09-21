/** Styling offered for existing Nadeshiko Anki note fields. */
export const ANKI_CARD_CSS = `/* Nadeshiko word fields */
.nd-senses { margin: 6px 0 0 !important; padding-left: 18px !important; list-style: decimal !important; text-align: left !important; }
.nd-sense { margin: 5px 0 !important; line-height: 1.45 !important; }
.nd-sense::marker { color: #9a9a9a !important; }
.nd-pos, .nd-tag { display: inline-block !important; margin: 0 4px 3px 0 !important; padding: 0 6px !important; border: 1px solid rgba(0, 0, 0, 0.18) !important; border-radius: 999px !important; font-size: 10px !important; font-weight: 600 !important; line-height: 16px !important; white-space: nowrap !important; }
.nd-pos { color: #be185d !important; background: rgba(190, 24, 93, 0.08) !important; }
.nd-tag { color: #6b7280 !important; background: rgba(107, 114, 128, 0.1) !important; }
.nd-gloss { display: block !important; }
.nd-gloss-row + .nd-gloss-row { margin-top: 2px !important; }
.nd-gloss-item + .nd-gloss-item { margin-top: 2px !important; }
.nd-gloss-title { display: block !important; margin-top: 3px !important; font-size: 11px !important; font-weight: 600 !important; color: #6b7280 !important; }
.nd-usage { margin-top: 4px !important; font-size: 12px !important; color: #6b7280 !important; }
.nd-sense-note { margin-top: 2px !important; font-size: 11px !important; font-style: italic !important; color: #6b7280 !important; }
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
.night_mode .nd-gloss-title, .night_mode .nd-usage, .night_mode .nd-sense-note { color: #a5a5a5 !important; }
.night_mode .nd-mora--high { border-top-color: #f472b6 !important; }
.night_mode .nd-mora--drop { border-right-color: #f472b6 !important; }
.night_mode .nd-badge { background: #303030 !important; color: #cfcfcf !important; }
.night_mode .nd-source-link { color: #a5a5a5 !important; }
`;

export interface MinedWord {
  /** The dictionary form, plain. */
  word: string;
  /** Kana, plain. Empty when the headword is already kana. */
  reading: string;
  /** `手加減[てかげん]`, Anki's own ruby notation. */
  furigana: string;
  /**
   * Every dictionary's senses, numbered, or '' when none of them had anything
   * the reader reads.
   *
   * ALWAYS the whole stack. It used to be "the first N dictionaries", with N set
   * on the settings page, which meant a field mapped to `{definition}` quietly
   * changed what it contained when a number moved on another screen. The two
   * fields below are the split; this one is the answer to "what does this word
   * mean", and it means the same thing forever.
   */
  definition: string;
  /**
   * How many dictionaries the reader ticked, or 0 when they ticked none.
   *
   * Not content -- nothing writes it to a field. A pick has already been applied
   * to the three definition fields above by the time this is read, and this is
   * only here so the export event can report how often picking is used without
   * inferring it from how long a definition came out.
   */
  pickedDictionaries: number;
  /**
   * How common the word is, as a corpus rank: `155`, plain digits.
   *
   * Its own field because Lapis sorts a deck on it (`FreqSort` <- Yomitan's
   * `{frequency-harmonic-rank}`), and that needs a number Anki can order rather
   * than the `#155` badge the card prints.
   */
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
   * The first dictionary in the reader's stack, for `{definition-first}`.
   *
   * Yomitan's `{glossary-first}` is the same idea: its template renders
   * `definition.definitions.[0]`, which in grouped mode is the top dictionary in
   * the reader's own priority order, and it ships `-brief` and `-no-dictionary`
   * variants of it. Lapis does not use it -- its MainDefinition names a
   * dictionary outright (`{single-glossary-jmdict/jitendex}`) -- so both shapes
   * exist in the wild and this offers both.
   *
   * Worth having beside `{definition:<slug>}` because it needs no setup and
   * cannot go stale: stack order is a preference the reader already expressed in
   * Shirabe, and swapping a dictionary out re-points this for free where a named
   * slug would quietly go empty.
   */
  definitionFirst: string;
  /**
   * One rendered definition per dictionary, keyed by SLUG, for
   * `{definition:<slug>}`.
   *
   * Keyed on the slug rather than the name because this is what a stored Anki
   * field mapping points at, and a name moves. Only dictionaries that actually
   * answered for this word appear -- a reader who maps a dictionary the word is
   * not in gets no key, which is what tells the export the field has nothing to
   * say.
   */
  definitionsByDictionary: Record<string, string>;
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
