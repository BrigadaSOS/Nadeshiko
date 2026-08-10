export interface SlimToken {
  s: string;
  d: string;
  r: string;
  b: number;
  e: number;
  p: string;
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
  /** Raw UniDic tag (動詞). Not `posDisplay`. */
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
    for (const seg of furiganaOf(token)) {
      result += seg.reading ? ` ${seg.text}[${seg.reading}]` : seg.text;
    }
    pos = token.e;
  }

  if (pos < content.length) {
    result += content.slice(pos);
  }

  // No separator space needed when the sentence opens with a furigana word.
  return result.replace(/^ /, '');
}

function katakanaToHiragana(str: string): string {
  return str.replace(/[\u30A1-\u30F6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

export function hiraganaToKatakana(str: string): string {
  return str.replace(/[\u3041-\u3096]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

const ROMAJI_DIGRAPHS: Record<string, string> = {
  きゃ: 'kya',
  きゅ: 'kyu',
  きょ: 'kyo',
  しゃ: 'sha',
  しゅ: 'shu',
  しょ: 'sho',
  ちゃ: 'cha',
  ちゅ: 'chu',
  ちょ: 'cho',
  にゃ: 'nya',
  にゅ: 'nyu',
  にょ: 'nyo',
  ひゃ: 'hya',
  ひゅ: 'hyu',
  ひょ: 'hyo',
  みゃ: 'mya',
  みゅ: 'myu',
  みょ: 'myo',
  りゃ: 'rya',
  りゅ: 'ryu',
  りょ: 'ryo',
  ぎゃ: 'gya',
  ぎゅ: 'gyu',
  ぎょ: 'gyo',
  じゃ: 'ja',
  じゅ: 'ju',
  じょ: 'jo',
  ぢゃ: 'ja',
  ぢゅ: 'ju',
  ぢょ: 'jo',
  びゃ: 'bya',
  びゅ: 'byu',
  びょ: 'byo',
  ぴゃ: 'pya',
  ぴゅ: 'pyu',
  ぴょ: 'pyo',
};

const ROMAJI_MONOGRAPHS: Record<string, string> = {
  あ: 'a',
  い: 'i',
  う: 'u',
  え: 'e',
  お: 'o',
  か: 'ka',
  き: 'ki',
  く: 'ku',
  け: 'ke',
  こ: 'ko',
  さ: 'sa',
  し: 'shi',
  す: 'su',
  せ: 'se',
  そ: 'so',
  た: 'ta',
  ち: 'chi',
  つ: 'tsu',
  て: 'te',
  と: 'to',
  な: 'na',
  に: 'ni',
  ぬ: 'nu',
  ね: 'ne',
  の: 'no',
  は: 'ha',
  ひ: 'hi',
  ふ: 'fu',
  へ: 'he',
  ほ: 'ho',
  ま: 'ma',
  み: 'mi',
  む: 'mu',
  め: 'me',
  も: 'mo',
  や: 'ya',
  ゆ: 'yu',
  よ: 'yo',
  ら: 'ra',
  り: 'ri',
  る: 'ru',
  れ: 're',
  ろ: 'ro',
  わ: 'wa',
  ゐ: 'i',
  ゑ: 'e',
  を: 'o',
  が: 'ga',
  ぎ: 'gi',
  ぐ: 'gu',
  げ: 'ge',
  ご: 'go',
  ざ: 'za',
  じ: 'ji',
  ず: 'zu',
  ぜ: 'ze',
  ぞ: 'zo',
  だ: 'da',
  ぢ: 'ji',
  づ: 'zu',
  で: 'de',
  ど: 'do',
  ば: 'ba',
  び: 'bi',
  ぶ: 'bu',
  べ: 'be',
  ぼ: 'bo',
  ぱ: 'pa',
  ぴ: 'pi',
  ぷ: 'pu',
  ぺ: 'pe',
  ぽ: 'po',
  ん: 'n',
};

export function hiraganaToRomaji(str: string): string {
  let result = '';
  let i = 0;
  while (i < str.length) {
    const ch = str[i];

    // Small tsu (っ) — double the next consonant
    if (ch === 'っ') {
      const digraph = str.slice(i + 1, i + 3);
      const mono = str[i + 1] ?? '';
      const nextRomaji = ROMAJI_DIGRAPHS[digraph] ?? ROMAJI_MONOGRAPHS[mono] ?? '';
      result += nextRomaji.charAt(0) || 't';
      i++;
      continue;
    }

    // Long vowel mark (ー) — repeat last vowel
    if (ch === 'ー') {
      const lastVowel = result.match(/[aeiou]$/)?.[0] ?? '';
      result += lastVowel;
      i++;
      continue;
    }

    // Digraph (2-char combination)
    const digraph = str.slice(i, i + 2);
    const digraphRomaji = ROMAJI_DIGRAPHS[digraph];
    if (digraphRomaji) {
      result += digraphRomaji;
      i += 2;
      continue;
    }

    // Monograph
    const monoRomaji = ch ? ROMAJI_MONOGRAPHS[ch] : undefined;
    if (monoRomaji) {
      result += monoRomaji;
      i++;
      continue;
    }

    // Pass through (non-hiragana characters, punctuation, etc.)
    result += ch;
    i++;
  }
  return result;
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
      lookupRef: { lemma: token.d, surface: token.s, reading: token.r, pos: token.p },
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
