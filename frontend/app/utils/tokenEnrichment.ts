export interface SlimToken {
  s: string;
  d: string;
  r: string;
  b: number;
  e: number;
  p: string;
  p1?: string;
  p2?: string;
  p4?: string;
  cf?: string;
}

export interface EnrichedToken extends SlimToken {
  matchType: 'match' | 'compound' | 'none';
  searchText: string;
  groupId: number | null;
  isGroupStem: boolean;
  displaySurface: string;
  dictForm: string;
  reading: string;
  dictReading: string;
  posJa: string;
  posEn: string;
  posSubJa: string;
  posSubEn: string;
  conjClassJa: string;
  conjClassEn: string;
  conjFormJa: string;
  conjFormEn: string;
  auxMeanings: Array<{ ja: string; en: string }>;
}

interface GroupData {
  stemIdx: number;
  surface: string;
  size: number;
  readingKata: string;
  auxMeanings: Array<{ ja: string; en: string }>;
}

const KANJI_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

export interface FuriganaSegment {
  text: string;
  reading: string;
}

export function segmentFurigana(surface: string, reading: string): FuriganaSegment[] {
  if (!KANJI_RE.test(surface)) return [{ text: surface, reading: '' }];

  const parts: Array<{ text: string; isKanji: boolean }> = [];
  let current = '';
  let currentIsKanji = KANJI_RE.test(surface[0] ?? '');

  for (const ch of surface) {
    const isKanji = KANJI_RE.test(ch);
    if (isKanji !== currentIsKanji) {
      if (current) parts.push({ text: current, isKanji: currentIsKanji });
      current = ch;
      currentIsKanji = isKanji;
    } else {
      current += ch;
    }
  }
  if (current) parts.push({ text: current, isKanji: currentIsKanji });

  if (parts.length === 1) {
    return [{ text: surface, reading: parts[0]!.isKanji ? reading : '' }];
  }

  const segments: FuriganaSegment[] = [];
  let readingPos = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;

    if (!part.isKanji) {
      const kanaReading = katakanaToHiragana(part.text);
      const idx = reading.indexOf(kanaReading, readingPos);
      if (idx >= readingPos && idx <= readingPos + 10) {
        if (idx > readingPos && i > 0) {
          const prev = segments[segments.length - 1];
          if (prev && prev.reading) {
            prev.reading += reading.slice(readingPos, idx);
          }
        }
        segments.push({ text: part.text, reading: '' });
        readingPos = idx + kanaReading.length;
      } else {
        segments.push({ text: part.text, reading: '' });
      }
    } else {
      let kanjiReading = '';
      const nextNonKanji = parts[i + 1];
      if (nextNonKanji && !nextNonKanji.isKanji) {
        const kanaReading = katakanaToHiragana(nextNonKanji.text);
        const idx = reading.indexOf(kanaReading, readingPos);
        if (idx > readingPos) {
          kanjiReading = reading.slice(readingPos, idx);
          readingPos = idx;
        }
      } else if (i === parts.length - 1) {
        kanjiReading = reading.slice(readingPos);
        readingPos = reading.length;
      }
      segments.push({ text: part.text, reading: kanjiReading });
    }
  }

  return segments;
}

const STEM_POS = new Set(['動詞', '形容詞']);
const MORPHO_CONJ_PARTICLES = new Set(['て', 'で', 'ちゃ']);

export function katakanaToHiragana(str: string): string {
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
    if (ROMAJI_DIGRAPHS[digraph]) {
      result += ROMAJI_DIGRAPHS[digraph];
      i += 2;
      continue;
    }

    // Monograph
    if (ROMAJI_MONOGRAPHS[ch]) {
      result += ROMAJI_MONOGRAPHS[ch];
      i++;
      continue;
    }

    // Pass through (non-hiragana characters, punctuation, etc.)
    result += ch;
    i++;
  }
  return result;
}

export const POS_LABELS: Record<string, string> = {
  動詞: 'Verb',
  名詞: 'Noun',
  形容詞: 'Adjective',
  副詞: 'Adverb',
  助詞: 'Particle',
  助動詞: 'Auxiliary',
  連体詞: 'Adnominal',
  接続詞: 'Conjunction',
  感動詞: 'Interjection',
  接頭辞: 'Prefix',
  接尾辞: 'Suffix',
  記号: 'Symbol',
  補助記号: 'Punctuation',
  空白: 'Whitespace',
};

export const POS_SUB_LABELS: Record<string, string> = {
  普通名詞: 'Common Noun',
  固有名詞: 'Proper Noun',
  数詞: 'Numeral',
  代名詞: 'Pronoun',
  非自立可能: 'Auxiliary-capable',
  格助詞: 'Case Particle',
  係助詞: 'Binding Particle',
  副助詞: 'Adverbial Particle',
  接続助詞: 'Conjunctive Particle',
  終助詞: 'Sentence-final Particle',
  準体助詞: 'Nominalizing Particle',
};

export const CONJ_FORM_LABELS: Record<string, string> = {
  連用形: 'Continuative',
  終止形: 'Plain Form',
  連体形: 'Attributive',
  未然形: 'Irrealis',
  仮定形: 'Conditional',
  命令形: 'Imperative',
  意志推量形: 'Volitional',
  語幹: 'Stem',
  音便形: 'Euphonic',
};

export const CONJ_CLASS_LABELS: Record<string, string> = {
  五段: 'Godan',
  上一段: 'Ichidan (-iru)',
  下一段: 'Ichidan (-eru)',
  サ行変格: 'Irregular (する)',
  カ行変格: 'Irregular (くる)',
  形容詞: 'I-adjective',
  文語形容詞: 'Classical adj.',
  文語サ行変格: 'Classical irreg.',
};

export const AUX_LABELS: Record<string, { ja: string; en: string }> = {
  // 助動詞 (grammatical auxiliaries)
  れる: { ja: '受身/可能', en: 'Passive/Potential' },
  られる: { ja: '受身/可能', en: 'Passive/Potential' },
  せる: { ja: '使役', en: 'Causative' },
  させる: { ja: '使役', en: 'Causative' },
  ない: { ja: '否定', en: 'Negative' },
  ぬ: { ja: '否定', en: 'Negative' },
  た: { ja: '過去', en: 'Past' },
  て: { ja: 'て形', en: 'Te-form' },
  てる: { ja: '進行/継続', en: 'Progressive' },
  ます: { ja: '丁寧', en: 'Polite' },
  たい: { ja: '希望', en: 'Desiderative' },
  だ: { ja: '断定', en: 'Copula' },
  です: { ja: '丁寧', en: 'Polite Copula' },
  そうだ: { ja: '様態/伝聞', en: 'Hearsay/Seems' },
  ようだ: { ja: '様態', en: 'Appears (like)' },
  らしい: { ja: '推定', en: 'Apparently' },
  べし: { ja: '当然/義務', en: 'Should/Must' },
  // 補助動詞 (subsidiary verbs — 動詞 with p1=非自立可能)
  いる: { ja: '進行/状態', en: 'Progressive' },
  居る: { ja: '進行/状態', en: 'Progressive' },
  ある: { ja: '結果状態', en: 'Resultative' },
  有る: { ja: '結果状態', en: 'Resultative' },
  くる: { ja: '変化', en: 'Gradual change' },
  来る: { ja: '変化', en: 'Gradual change' },
  いく: { ja: '推移', en: 'Ongoing change' },
  行く: { ja: '推移', en: 'Ongoing change' },
  しまう: { ja: '完了', en: 'Completive' },
  仕舞う: { ja: '完了', en: 'Completive' },
  おく: { ja: '準備', en: 'Preparatory' },
  置く: { ja: '準備', en: 'Preparatory' },
  みる: { ja: '試み', en: 'Try' },
  見る: { ja: '試み', en: 'Try' },
  くれる: { ja: '恩恵(くれる)', en: 'For me' },
  くださる: { ja: '丁寧恩恵', en: 'Please (polite)' },
  あげる: { ja: '恩恵(あげる)', en: 'For someone' },
  上げる: { ja: '恩恵(あげる)', en: 'For someone' },
  もらう: { ja: '恩恵(もらう)', en: 'Receive favor' },
  貰う: { ja: '恩恵(もらう)', en: 'Receive favor' },
  いただく: { ja: '丁寧恩恵', en: 'Receive (humble)' },
  なる: { ja: '変化', en: 'Become' },
  する: { ja: '〜する', en: 'Suru' },
  できる: { ja: '可能', en: 'Can' },
  出す: { ja: '突発', en: 'Start suddenly' },
  始める: { ja: '開始', en: 'Begin' },
  続ける: { ja: '継続', en: 'Continue' },
  終わる: { ja: '完了', en: 'Finish' },
  すぎる: { ja: '過度', en: 'Too much' },
  過ぎる: { ja: '過度', en: 'Too much' },
  // 補助形容詞 (subsidiary adjectives — 形容詞 with p1=非自立可能)
  いい: { ja: '許容', en: 'OK/Fine' },
  よい: { ja: '許容', en: 'OK/Fine' },
  良い: { ja: '許容', en: 'OK/Fine' },
  欲しい: { ja: '希望', en: 'Want' },
  なし: { ja: '否定', en: 'Negative' },
};

function addAuxLabel(group: GroupData, dictForm: string) {
  const label = AUX_LABELS[dictForm];
  if (label && !group.auxMeanings.some((a) => a.en === label.en)) {
    group.auxMeanings.push(label);
  }
}

function canContinueGroup(token: SlimToken): boolean {
  if (token.p === '助動詞') return true;
  if (token.p === '助詞' && token.p1 === '接続助詞' && MORPHO_CONJ_PARTICLES.has(token.s)) return true;
  if (STEM_POS.has(token.p) && token.p1 === '非自立可能') return true;
  return false;
}

export function enrichTokens(tokens: SlimToken[], highlight?: string): EnrichedToken[] {
  if (tokens.length === 0) return [];

  const matchRanges: Array<{ start: number; end: number }> = [];
  if (highlight) {
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
        matchRanges.push({ start, end: charPos });
        i += 5;
      } else {
        charPos++;
        i++;
      }
    }
  }

  // Build compound groups in a single pass: stem (verb/adjective) + auxiliaries/particles
  const groupByIndex = new Map<number, number>();
  const groups = new Map<number, GroupData>();
  let groupId = 0;
  let inGroup = false;

  for (let idx = 0; idx < tokens.length; idx++) {
    const token = tokens[idx];
    if (!token) continue;
    const isAuxCapable = STEM_POS.has(token.p) && token.p1 === '非自立可能';

    if (STEM_POS.has(token.p) && !(inGroup && isAuxCapable)) {
      if (inGroup) groupId++;
      inGroup = true;
      groupByIndex.set(idx, groupId);
      groups.set(groupId, {
        stemIdx: idx,
        surface: token.s,
        size: 1,
        readingKata: token.r,
        auxMeanings: [],
      });
    } else if (inGroup && canContinueGroup(token)) {
      groupByIndex.set(idx, groupId);
      const g = groups.get(groupId);
      if (!g) continue;
      g.surface += token.s;
      g.size++;
      g.readingKata += token.r;
      addAuxLabel(g, token.d);
    } else {
      if (inGroup) {
        groupId++;
        inGroup = false;
      }
    }
  }

  // Base match types from ES highlight ranges
  const baseMatchTypes = tokens.map((token) =>
    matchRanges.some((r) => token.b < r.end && token.e > r.start) ? ('match' as const) : ('none' as const),
  );

  return tokens.map((token, idx) => {
    const gid = groupByIndex.get(idx);
    const group = gid !== undefined ? groups.get(gid) : undefined;
    const isMultiTokenGroup = group !== undefined && group.size > 1;
    const stemToken = group ? tokens[group.stemIdx] : undefined;

    let matchType: 'match' | 'compound' | 'none' = baseMatchTypes[idx] ?? 'none';
    if (matchType === 'none' && isMultiTokenGroup && group?.stemIdx !== idx) {
      if (baseMatchTypes[group?.stemIdx] === 'match') {
        matchType = 'compound';
      }
    }

    const posForLabel = isMultiTokenGroup && stemToken ? stemToken.p : token.p;
    const tokenForSub = isMultiTokenGroup && stemToken ? stemToken : token;
    const posSubJa = tokenForSub.p1 ?? '';
    const showSubPos = posSubJa && posSubJa !== '非自立可能';

    const stemForClass = isMultiTokenGroup && stemToken ? stemToken : token;
    const p4Base = stemForClass.p4?.split('-')[0] ?? '';
    const conjClassJa = STEM_POS.has(stemForClass.p) && p4Base ? p4Base : '';

    const cfBase = token.cf?.split('-')[0] ?? '';
    const isConjugatable = token.p === '動詞' || token.p === '形容詞' || token.p === '助動詞';
    const conjFormJa = !isMultiTokenGroup && isConjugatable && cfBase ? cfBase : '';

    const isGroupStem = isMultiTokenGroup && group?.stemIdx === idx;

    return {
      ...token,
      matchType,
      searchText: isMultiTokenGroup && stemToken ? stemToken.d : token.d,
      groupId: isMultiTokenGroup ? (gid ?? null) : null,
      isGroupStem,
      displaySurface: isMultiTokenGroup ? group?.surface : token.s,
      dictForm: isMultiTokenGroup && stemToken ? stemToken.d : token.d,
      reading: isMultiTokenGroup ? katakanaToHiragana(group?.readingKata) : katakanaToHiragana(token.r),
      dictReading: isMultiTokenGroup ? '' : katakanaToHiragana(token.r),
      posJa: posForLabel,
      posEn: POS_LABELS[posForLabel] ?? posForLabel,
      posSubJa: showSubPos ? posSubJa : '',
      posSubEn: showSubPos ? (POS_SUB_LABELS[posSubJa] ?? '') : '',
      conjClassJa,
      conjClassEn: conjClassJa ? (CONJ_CLASS_LABELS[conjClassJa] ?? '') : '',
      conjFormJa,
      conjFormEn: conjFormJa ? (CONJ_FORM_LABELS[conjFormJa] ?? '') : '',
      auxMeanings: isMultiTokenGroup ? group?.auxMeanings : [],
    };
  });
}
