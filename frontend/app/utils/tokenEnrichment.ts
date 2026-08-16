export interface SlimToken {
  s: string;
  d: string;
  r: string;
  b: number;
  e: number;
  p: string;
  /**
   * Shirabe's short part-of-speech tag (`verb`, `prt`, `exp`), which is what
   * `POST /api/v1/words/identify` ranks by.
   *
   * Optional because it is newer than the corpus: tokens parsed before it was
   * stored have only `p`, and `shortPos` below derives one from that. Prefer
   * this when it is here -- the derivation is a copy of Shirabe's own table and
   * a copy is a thing that can drift, while this is the value itself.
   */
  pt?: string;
  /** word | compound | inflected | counter | function | expression | symbol. */
  kind?: string;
  /** Ruby, already aligned to this surface. Absent when there is none to show,
   *  which is the ordinary case for an all-kana word. */
  f?: Array<{ t: string; r?: string }>;
  /** The part of speech in words ("Verb", "Particle", "Expression"). Shirabe
   *  resolves it, so there is no UniDic table to keep here and no gap when it
   *  emits a category a hand-written table never had. */
  posLabel?: string;
  /** What this surface does to its dictionary form, outermost step first:
   *  食べました is ["past", "polite"]. Japanese stacks, so it is a chain rather
   *  than one name, and an ambiguous step says so ("potential / passive")
   *  rather than picking a side. Absent for anything uninflected. */
  inflection?: { labels: string[]; base: string };
  /** The finer morphemes inside a grouped token. Elasticsearch highlights
   *  against its own analyzer, so a match can land inside one of ours. */
  parts?: Array<{ s: string; b: number; e: number }>;
  /**
   * Which sentence of an expanded segment this token came from. Absent on an
   * ordinary result -- only `buildExpandedTexts` sets it, and only on a merge.
   *
   * This is where an expansion marks the halves it pulled in. It cannot be done
   * in the text the way the translations do it, because these tokens address
   * that text by offset: see `concatJapanese`.
   */
  origin?: 'before' | 'current' | 'after';
}

/**
 * How a token addresses its dictionary entry.
 *
 * Built here, once, so no caller assembles it by hand out of single-letter
 * fields -- which is where it used to go wrong. `reading` is KATAKANA and `pos`
 * is the RAW UniDic tag, because that is what Shirabe resolves against; the
 * display forms of both are different values living on the same object, and
 * sending those instead returns 200 for the wrong word rather than failing.
 */
export interface WordRef {
  /** Dictionary form. */
  lemma: string;
  /** How it was written here. */
  surface: string;
  /** Katakana, as the analyzer read THIS surface. Not `readingHiragana`. */
  reading: string;
  /**
   * Shirabe's SHORT part-of-speech tag (`verb`, `prt`, `pron`), never the raw
   * UniDic one (動詞) and never the printable `posLabel`.
   *
   * This used to carry the UniDic tag, back when the lookup was a word page that
   * ignored it. `POST /api/v1/words/identify` reads it, and reads it against a
   * closed vocabulary: a tag outside that vocabulary is not an error, it just
   * skips the rung of the ranking that a closed word class decides. That is the
   * rung きみ needs -- read as a pronoun it is 君, and without the tag the
   * spelling alone answers the grain 黍.
   */
  pos: string;
}

export interface EnrichedToken extends SlimToken {
  matchType: 'match' | 'partial' | 'none';
  displaySurface: string;
  dictForm: string;
  /**
   * Hiragana, for showing to a reader and for the external dictionary links.
   *
   * NAMED FOR ITS SCRIPT on purpose. This used to be `reading`, one letter from
   * the `r` it is derived from and a different script -- so the two sat on the
   * same object looking interchangeable, and a lookup handed the hiragana one
   * resolves a homograph by a reading Shirabe does not key on. `lookupRef`
   * carries the katakana; this is only ever for display.
   */
  readingHiragana: string;
  /** Everything the dictionary lookup asks by, assembled once. */
  lookupRef: WordRef;
  /** The inflection chain to print, already ordered and localized. Empty when
   *  the token is not an inflected word. */
  inflectionLabels: string[];
  furigana: FuriganaSegment[];
  /** Highlighted spans in token-local characters, when a match covers only part
   *  of this token. Empty unless matchType is 'partial'. */
  highlightRanges: Array<{ start: number; end: number }>;
}

export interface FuriganaSegment {
  text: string;
  reading: string;
}

/** Ruby for a token, as Shirabe aligned it.
 *
 * There used to be a `segmentFurigana` here that split a surface into kanji runs
 * and dealt them the reading a character at a time. It is gone: aligning kana to
 * a mixed surface goes wrong on okurigana, 熟字訓, and any reading that spans two
 * kanji runs, and Shirabe already does it against the dictionary that knows which
 * reading applies to which writing. A token with no `f` has nothing to show, so
 * it renders bare.
 */
export function furiganaOf(token: SlimToken): FuriganaSegment[] {
  if (!token.f || token.f.length === 0) return [{ text: token.s, reading: '' }];
  return token.f.map((segment) => ({ text: segment.t, reading: segment.r ?? '' }));
}

/**
 * Append ruby segments to a field already under construction, in Anki's
 * `漢字[かんじ]` notation.
 *
 * Takes what has been written so far rather than returning a piece to join,
 * because the separator rule below is a question about the character before the
 * segment, not about the segment itself -- so a caller assembling a sentence out
 * of pieces could not apply it without reimplementing it.
 */
function appendAnkiFurigana(result: string, segments: FuriganaSegment[]): string {
  for (const seg of segments) {
    // The leading space is a DELIMITER -- it marks where the previous word's
    // kana ended -- so it is only wanted where there is not one already: at
    // the start of the field, or after whitespace the content itself carries.
    // Anki renders a doubled one literally.
    //
    // This used to be a `replace(/^ /, '')` at the end, which is the same rule
    // applied to the start of the string alone. That was enough while a
    // sentence was one segment, because an interior gap before a kanji word is
    // rare. An expanded sentence meets one at every join -- the segments are
    // merged with a space, and the next word begins right after it.
    const separator = seg.reading && result !== '' && !/\s$/.test(result) ? ' ' : '';
    result += seg.reading ? `${separator}${seg.text}[${seg.reading}]` : seg.text;
  }
  return result;
}

/**
 * One word on its own in Anki furigana notation, e.g. `手加減[てかげん]`.
 *
 * The standalone counterpart to `tokensToAnkiFurigana`, sharing its rule rather
 * than restating it: a headword mined into its own field is the same notation
 * with nothing before it, so the separator never fires and the difference is
 * only that there is no surrounding sentence to slice gaps out of.
 */
export function furiganaNotation(segments: FuriganaSegment[]): string {
  return appendAnkiFurigana('', segments);
}

/**
 * Render a tokenized sentence in Anki furigana notation, e.g.
 * `そっか　10 年[ねん] 前[まえ]の 初恋[はつこい]`. Each kanji run is followed by its
 * reading in brackets and prefixed with a separator space (the Anki convention
 * for delimiting where the previous word's kana ends). Gaps between tokens
 * (spaces, punctuation) are copied verbatim from the original content.
 */
export function tokensToAnkiFurigana(content: string, tokens: SlimToken[]): string {
  let result = '';
  let pos = 0;

  for (const token of tokens) {
    if (token.b > pos) {
      result += content.slice(pos, token.b);
    }
    result = appendAnkiFurigana(result, furiganaOf(token));
    pos = token.e;
  }

  if (pos < content.length) {
    result += content.slice(pos);
  }

  return result;
}

function katakanaToHiragana(str: string): string {
  return str.replace(/[\u30A1-\u30F6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/** Parse the `<em>` spans Elasticsearch marks a match with into character ranges
 *  over the plain text. */
function highlightRanges(highlight: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let charPos = 0;
  let i = 0;

  while (i < highlight.length) {
    if (highlight.startsWith('<em>', i)) {
      const start = charPos;
      i += 4;
      while (i < highlight.length && !highlight.startsWith('</em>', i)) {
        charPos++;
        i++;
      }
      ranges.push({ start, end: charPos });
      i += 5;
    } else {
      charPos++;
      i++;
    }
  }
  return ranges;
}

/** Presentation for a token, from a token that already knows what it is.
 *
 * This used to reconstruct the word: a pass that walked the array joining a verb
 * to its auxiliaries, a table of 55 auxiliary glosses, and a set of rules about
 * which particles continue a group. Shirabe does that upstream now and 食べました
 * arrives as one token, so all of it is gone and this only labels and highlights.
 *
 * The one genuinely harder thing is highlighting. Elasticsearch analyzes textJa
 * with its OWN embedded Sudachi, so a match range can land inside one of our
 * tokens rather than on its edges. Such a token is 'partial' and carries the
 * offending ranges in token-local characters, so a caller can emphasize the part
 * that matched instead of lighting up a whole word the reader did not search for.
 */
/**
 * UniDic's top-level part of speech, in Shirabe's short vocabulary.
 *
 * A deliberate copy of `Tokenizer::POS_LABELS` on their side, and the only table
 * of its kind left here -- `POS_LABELS`, `POS_SUB_LABELS`, `CONJ_FORM_LABELS`,
 * `CONJ_CLASS_LABELS` and the 55-entry `AUX_LABELS` all went when Shirabe took
 * over the parsing, and none of them is coming back.
 *
 * This one earns its place by being temporary and closed. `identify` needs the
 * short tag; our stored tokens carry only `p`, because `parseSegments.ts` maps
 * `posFull[0]` and drops the short one. Deriving costs seventeen entries over a
 * fixed set of UniDic categories, where re-parsing the corpus to store the tag
 * costs a corpus pass. So: derive now, store `pt` when the corpus is next
 * re-tokenized, and delete this once every token carries one.
 *
 * `連語` is the entry that is not in their table. It is a merged grammatical
 * expression (について, けれども) with no single morpheme to take a POS from, so
 * Shirabe assigns `exp` when it builds the chip rather than when it maps the
 * morpheme. The three that map to an empty string are punctuation, symbols and
 * whitespace -- nothing identify could rank, and `isAskable` filters them out
 * before it ever gets here.
 */
const SHORT_POS: Record<string, string> = {
  名詞: 'noun',
  動詞: 'verb',
  形容詞: 'adj',
  形状詞: 'adj',
  副詞: 'adv',
  助詞: 'prt',
  助動詞: 'aux',
  代名詞: 'pron',
  連体詞: 'det',
  接続詞: 'conj',
  感動詞: 'intj',
  接頭辞: 'pref',
  接尾辞: 'suf',
  連語: 'exp',
  補助記号: '',
  記号: '',
  空白: '',
};

/**
 * The tag to send `identify`: the token's own when it has one, ours otherwise.
 *
 * An unknown category answers '' rather than passing the raw Japanese through.
 * Shirabe treats an unrecognised tag as no tag, so the two are the same answer
 * to the ranker -- but only one of them can end up printed somewhere by a caller
 * that assumed this was a label.
 */
export function shortPos(token: SlimToken): string {
  return token.pt ?? SHORT_POS[token.p] ?? '';
}

export function enrichTokens(tokens: SlimToken[], highlight?: string): EnrichedToken[] {
  if (tokens.length === 0) return [];

  const ranges = highlight ? highlightRanges(highlight) : [];

  return tokens.map((token) => {
    const overlapping = ranges.filter((r) => token.b < r.end && token.e > r.start);
    const covered = overlapping.some((r) => r.start <= token.b && r.end >= token.e);
    const matchType: EnrichedToken['matchType'] = covered ? 'match' : overlapping.length > 0 ? 'partial' : 'none';

    return {
      ...token,
      matchType,
      highlightRanges: covered
        ? []
        : overlapping.map((r) => ({
            start: Math.max(0, r.start - token.b),
            end: Math.min(token.e - token.b, r.end - token.b),
          })),
      displaySurface: token.s,
      dictForm: token.d,
      readingHiragana: katakanaToHiragana(token.r),
      lookupRef: { lemma: token.d, surface: token.s, reading: token.r, pos: shortPos(token) },
      furigana: furiganaOf(token),
      // No `pos` alias here any more. It was `posLabel ?? p` -- a printable label
      // falling back to a raw UniDic tag -- sitting one letter from `p` on the
      // same object while meaning something else, and nothing ever read it.
      // `posLabel` is already on the token for display; `lookupRef.pos` carries
      // the raw tag for resolution.
      inflectionLabels: token.inflection?.labels ?? [],
    };
  });
}
