export interface SlimToken {
  s: string;
  d: string;
  r: string;
  b: number;
  e: number;
  p: string;
  /**
   * Shirabe's short POS tag for `words/identify`. Prefer it over the copied fallback table; older tokens may
   * carry only `p`.
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
   * Sentence provenance set on expansion. Keep it outside the text because token offsets address the
   * unwrapped content.
   */
  origin?: 'before' | 'current' | 'after';
}

/**
 * Dictionary lookup coordinates assembled once: reading is katakana and POS is Shirabe's short tag, not
 * either display value. Wrong representations can silently resolve the wrong homograph.
 */
export interface WordRef {
  /** Dictionary form. */
  lemma: string;
  /** How it was written here. */
  surface: string;
  /** Katakana, as the analyzer read THIS surface. Not `readingHiragana`. */
  reading: string;
  /**
   * Shirabe's short POS tag, never raw UniDic or printable `posLabel`. Unknown tags cannot provide the
   * ranker's grammatical disambiguation.
   */
  pos: string;
}

export interface EnrichedToken extends SlimToken {
  matchType: 'match' | 'partial' | 'none';
  displaySurface: string;
  dictForm: string;
  /**
   * Hiragana for display and external dictionary links only; `lookupRef` retains the analyzer's katakana
   * reading.
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

/**
 * Use Shirabe-aligned ruby; without `f`, render the surface bare rather than attempting local kana alignment.
 */
export function furiganaOf(token: SlimToken): FuriganaSegment[] {
  if (!token.f || token.f.length === 0) return [{ text: token.s, reading: '' }];
  return token.f.map((segment) => ({ text: segment.t, reading: segment.r ?? '' }));
}

/** Append Anki ruby notation using the preceding output character to decide whether a separator is needed. */
function appendAnkiFurigana(result: string, segments: FuriganaSegment[]): string {
  for (const seg of segments) {
    // The separator delimits preceding kana; do not add it at the start or after existing whitespace, where
    // Anki would render a doubled gap.
    const separator = seg.reading && result !== '' && !/\s$/.test(result) ? ' ' : '';
    result += seg.reading ? `${separator}${seg.text}[${seg.reading}]` : seg.text;
  }
  return result;
}

/** Standalone Anki furigana notation using the same separator rules as sentence export. */
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

/**
 * Elasticsearch's analyzer can match inside a Shirabe token. `enrichTokens` exposes partial ranges in
 * token-local coordinates rather than highlighting the whole word.
 */
/**
 * Fallback copy of Shirabe's short-POS vocabulary for tokens without `pt`, including old cached responses.
 * Remove only when no such token can arrive. `連語` maps to expression; punctuation, symbols and whitespace
 * have no lookup tag.
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
 * Prefer stored `pt`; otherwise map UniDic to a short tag. Unknown categories return empty rather than
 * leaking raw Japanese as a label.
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
      inflectionLabels: token.inflection?.labels ?? [],
    };
  });
}
