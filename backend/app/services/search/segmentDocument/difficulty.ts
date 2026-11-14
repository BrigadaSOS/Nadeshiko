/** Estimated sentence difficulty for the `DIFFICULTY_ASC` / `DIFFICULTY_DESC` sorts (#542), from how rare a sentence's
 * words are on the anime frequency list in `WordFrequency` and how advanced its conjugations are. Pure: the indexer
 * loads the rank lookup once and passes it in. It does not measure speech speed or what a given reader knows. The rule
 * and the numbers behind it are in `docs/search-difficulty.md`. */

import type { SlimToken } from '@app/models/Segment';

/** Ranks from the frequency list, lowest rank kept per key. `word` is keyed by the spelling; `form` by the kana form,
 * used only for a kana-written token. */
export interface RankLookup {
  word: ReadonlyMap<string, number>;
  form: ReadonlyMap<string, number>;
}

type DifficultyToken = Pick<SlimToken, 's' | 'd' | 'r' | 'p' | 'kind' | 'parts' | 'inflection'>;

/** Highest tier a listed word can reach; rank 46,341 and rarer all land here. */
export const MAX_RANK_TIER = 62;
/** A content word that is not on the list at all counts as a rank-5,000 word rather than the rarest one: on staging
 * these are mostly character names, which a reader learns from the show, and counting them as the rarest filled
 * "hardest first" with name-heavy lines. */
export const UNKNOWN_TIER = rankTier(5000);
/** A proper name on the list (田中, ナルト) is ranked by how often it occurs, which says nothing about how hard it is
 * to read: it counts at most as the same rank-5,000 word as an unlisted name. */
export const NAME_RANK_CAP = 5000;
/** Expressions (連語: のだ, そうだ, すると...) are split into pieces by the frequency list, so their own rank reads far rarer than
 * the words they are made of. They count at most as a rank-5,000 word. */
export const EXPRESSION_TIER_CAP = rankTier(5000);
/** The largest `difficulty` value: `MAX_RANK_TIER * 64 + MAX_RANK_TIER`. Fits an Elasticsearch `short`. */
export const MAX_DIFFICULTY = MAX_RANK_TIER * 64 + MAX_RANK_TIER;

const NON_CONTENT_KINDS = new Set(['function', 'symbol']);
/** Fallback for tokens parsed before Shirabe set `kind`: UniDic POS[0] of particles, auxiliaries and punctuation. */
const NON_CONTENT_POS = new Set(['助詞', '助動詞', '補助記号', '記号', '空白']);
const INTERJECTION_POS = '感動詞';
const EXPRESSION_POS = '連語';

/** Bidi marks some subtitle files carry, which the parser keeps as part of a "noun". */
const BIDI_MARKS = /[\u200E\u200F\u202A-\u202E]/g;
const HAS_LETTER = /\p{L}/u;
/** Latin-only tokens (OK, LINE, A) are loanwords, abbreviations or stray letters the frequency list does not rank,
 * so they would all count as unknown words. They do not count. */
const HAS_JAPANESE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const KANA_ONLY = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u;
/** A number: starts with a digit (3人, ２回), or is written in kanji numerals only (十, 二十五, 百万). A word that only
 * starts with one (十分, 百合, 千葉) is a word; 万一 is the one all-numeral word kept. */
const DIGIT_START = /^[0-9０-９]/;
const KANJI_NUMERAL = /^[〇零一二三四五六七八九十百千万億兆]+$/;
const NUMERAL_WORDS = new Set(['万一']);
const ELONGATION = /[ーッっぁぃぅぇぉ~〜…]+$/;
const HONORIFIC = /(ちゃん|くん|君|さん|様|さま|たち|達|ら|殿|先生|せんせー|せんせい)$/;
/** Potential verbs (勝てる, 会える) are lemmatised as their own verb; the list has the plain verb (勝つ, 会う). */
const POTENTIAL_TO_PLAIN: Readonly<Record<string, string>> = {
  てる: 'つ',
  える: 'う',
  ける: 'く',
  せる: 'す',
  ねる: 'ぬ',
  べる: 'ぶ',
  める: 'む',
  れる: 'る',
  げる: 'ぐ',
};
/** Lemmas the parser gets wrong (なった → なた, あった → あた) or spells the UniDic way (感ずる for 感じる). */
const LEMMA_ALIASES: Readonly<Record<string, string>> = { あた: 'ある', なた: 'なる', 感ずる: '感じる' };

function toHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

function stripBidi<T extends DifficultyToken>(token: T): T {
  return { ...token, s: token.s.replace(BIDI_MARKS, ''), d: token.d.replace(BIDI_MARKS, '') };
}

function isNumeral(text: string): boolean {
  return DIGIT_START.test(text) || (KANJI_NUMERAL.test(text) && !NUMERAL_WORDS.has(text));
}

/** A word a reader has to know: not a particle, auxiliary, punctuation, interjection, number or Latin-only token. */
export function isContentToken(token: DifficultyToken): boolean {
  if (token.p === INTERJECTION_POS) return false;
  if (!HAS_LETTER.test(token.d)) return false;
  if (!HAS_JAPANESE.test(token.d) && !HAS_JAPANESE.test(token.s)) return false;
  if (isNumeral(token.d) || isNumeral(token.s)) return false;
  if (token.kind) return !NON_CONTENT_KINDS.has(token.kind);
  return !NON_CONTENT_POS.has(token.p);
}

/** Four tiers per doubling of rank: rank 1 → 0, 16 → 16, 1,000 → 39, 10,000 → 53, capped at `MAX_RANK_TIER`. */
export function rankTier(rank: number): number {
  return Math.min(MAX_RANK_TIER, Math.floor(4 * Math.log2(Math.max(1, rank))));
}

function rankOf(key: string, lookup: RankLookup): number | undefined {
  return lookup.word.get(key) ?? lookup.form.get(toHiragana(key));
}

/** The lowest rank among the token's spellings: lemma, surface, kana reading (only for a word written in kana as its
 * own lemma, so a homophone cannot stand in for a kanji word), and for a grouped token the rarest of its parts. */
function directRank(token: DifficultyToken, lookup: RankLookup): number | undefined {
  const ranks = [lookup.word.get(token.d), lookup.word.get(token.s)];
  if (token.s === token.d && token.r && KANA_ONLY.test(token.s)) ranks.push(lookup.form.get(toHiragana(token.r)));
  if (token.parts && token.parts.length > 1) {
    let rarest = 0;
    for (const part of token.parts) {
      const rank = rankOf(part.s, lookup);
      if (rank === undefined) {
        rarest = 0;
        break;
      }
      rarest = Math.max(rarest, rank);
    }
    if (rarest > 0) ranks.push(rarest);
  }
  let best: number | undefined;
  for (const rank of ranks) if (rank !== undefined && (best === undefined || rank < best)) best = rank;
  return best;
}

const MIN_REPAIRED_LENGTH = 2;

/** Frequency rank of a content token, or undefined when no spelling of it is on the list. */
export function lookupRank(token: DifficultyToken, lookup: RankLookup): number | undefined {
  const alias = LEMMA_ALIASES[token.d];
  if (alias) return lookup.word.get(alias);

  const direct = directRank(token, lookup);
  if (direct !== undefined) return direct;

  for (const key of [
    token.d.replace(ELONGATION, ''),
    token.s.replace(ELONGATION, ''),
    token.d.replace(HONORIFIC, ''),
  ]) {
    // At least two characters left: にぃ minus its small ぃ is the particle に, rank 3, which is not the word.
    if ([...key].length >= MIN_REPAIRED_LENGTH && key !== token.d) {
      const rank = rankOf(key, lookup);
      if (rank !== undefined) return rank;
    }
  }

  if (token.p === '動詞') {
    const plain = POTENTIAL_TO_PLAIN[token.d.slice(-2)];
    if (plain) return lookup.word.get(token.d.slice(0, -2) + plain);
  }
  return undefined;
}

function tokenTier(token: DifficultyToken, lookup: RankLookup): number {
  const rank = lookupRank(token, lookup);
  const tier = rank === undefined ? UNKNOWN_TIER : rankTier(rank);
  const isExpression = token.kind === 'expression' || token.p === EXPRESSION_POS;
  return isExpression ? Math.min(tier, EXPRESSION_TIER_CAP) : tier;
}

/**
 * Grammar adds a light term, as sentence-difficulty scorers commonly do: every conjugated token
 * contributes how much longer its surface is than its dictionary form (食べさせられた over 食べる is 4 characters), and
 * the sum, at about 1.7 tiers per character, raises the second place. It orders sentences within the group their
 * hardest word sets and never moves a sentence into a harder group, so grammar refines the order without outweighing
 * vocabulary. A label table that let grammar compete with words for the hardest place was tried first and, in a
 * blind test, overweighted causatives and set phrases (行かせない, 待たせてもらいました, 行ってくる).
 */
const GRAMMAR_TIERS_PER_CHARACTER = 1.7;
/** Polite endings and their plain counterparts. Politeness is register, not difficulty: measured as is, 食べました
 * outweighed 食べた and 食べませんでした outweighed 食べさせられた, which pushed polite speech down "easiest first".
 * The surface is measured as if plain (行きました as 行きた, as long as 行った); longest endings first. */
const POLITE_TO_PLAIN: readonly (readonly [string, string])[] = [
  ['ませんでした', 'なかった'],
  ['ましょう', 'よう'],
  ['ました', 'た'],
  ['ません', 'ない'],
  ['まして', 'て'],
  ['ます', ''],
  ['でしょう', ''],
  ['でした', ''],
  ['です', ''],
];

function plainSurface(surface: string): string {
  for (const [polite, plain] of POLITE_TO_PLAIN) {
    if (surface.endsWith(polite)) return surface.slice(0, -polite.length) + plain;
  }
  return surface;
}

/** Tiers of grammar in a sentence: the summed surface-over-lemma length of its conjugated tokens, polite endings
 * read as plain, scaled. */
export function grammarBonus(tokens: readonly DifficultyToken[]): number {
  let extra = 0;
  for (const token of tokens) {
    if (token.kind !== 'inflected' && !token.inflection) continue;
    extra += Math.max(0, [...plainSurface(token.s)].length - [...token.d].length);
  }
  return Math.round(extra * GRAMMAR_TIERS_PER_CHARACTER);
}

/**
 * `hardest * 64 + second` over the two hardest DISTINCT lemmas (second = 0 with a single content word), plus the
 * grammar term on the second place, capped so it stays within the hardest word's group; 0–4030.
 * Every search result contains the searched word, so this groups "only the searched word is hard" sentences together
 * and orders them by their context. Undefined when the sentence has no tokens or no content word, or when the
 * lookup is empty (the frequency list was never seeded), so those documents sort last.
 */
export function computeDifficulty(
  tokens: readonly DifficultyToken[] | null | undefined,
  lookup: RankLookup,
): number | undefined {
  if (!tokens?.length || lookup.word.size === 0) return undefined;

  const tierByLemma = new Map<string, number>();
  for (const raw of tokens) {
    const token = stripBidi(raw);
    if (!isContentToken(token)) continue;
    const tier = tokenTier(token, lookup);
    const previous = tierByLemma.get(token.d);
    if (previous === undefined || tier > previous) tierByLemma.set(token.d, tier);
  }
  if (tierByLemma.size === 0) return undefined;

  let hardest = -1;
  let second = 0;
  for (const tier of tierByLemma.values()) {
    if (tier > hardest) {
      if (hardest >= 0) second = hardest;
      hardest = tier;
    } else if (tier > second) {
      second = tier;
    }
  }
  return hardest * 64 + Math.min(MAX_RANK_TIER, second + grammarBonus(tokens));
}

/** Case and binding particles a line does not end on unless it was cut mid-sentence across subtitle cues
 * (猫が… / これは). Sentence-final particles (よ, ね, か, の) and conjunctive ones (から, けど, て) end real lines. */
const DANGLING_PARTICLES = new Set(['が', 'を', 'に', 'へ', 'で', 'と', 'は', 'も']);
const MIN_CONTENT_WORDS = 2;
/** A line ending in a question or exclamation mark is a finished utterance even after a particle: an inverted or
 * elliptical sentence (何を? / なんだ… これは! / 学校で!), not one cut across cues. */
const FINISHED_UTTERANCE = /[?？!！][\s」』）)"]*$/;
const TRAILING_COMMA = /[、，,]\s*$/;
/** An ellipsis or dash at the end: the line trails off (冷気だ...) or was cut across cues (会長の体って...). The long
 * vowel mark ー is not one: it ends real lines (さようならー). */
const TRAILING_OFF = /(\.\.\.|…|‥|[-－―⸺])[\s」』）)"]*$/;
/** Particles that end a finished sentence even before an ellipsis (そうだよ..., 行くかな...). Any other particle
 * before one (って..., けど..., 東京は...) leaves the sentence unfinished. */
const SENTENCE_FINAL_PARTICLES = new Set([
  'よ',
  'ね',
  'な',
  'ぞ',
  'ぜ',
  'わ',
  'さ',
  'か',
  'かな',
  'の',
  'もん',
  'っけ',
  'かしら',
  'ねえ',
  'なあ',
]);
const NOUN_POS = new Set(['名詞', '代名詞']);

function isParticle(token: DifficultyToken): boolean {
  return token.kind === 'function' || token.p === '助詞';
}

/**
 * Whether a line is too small or too cut off to be a useful example: fewer than two distinct content words (大丈夫,
 * 先生!), or ending on a comma, on a dangling particle without a closing ? or !, or on an ellipsis or dash right
 * after a particle or a noun (でも 先生..., 会長の体って...). The difficulty sorts put these after every complete
 * sentence, so "easiest first" does not open on hundreds of one-word lines. Undefined without tokens: such a segment
 * has no difficulty either and sorts last.
 *
 * Length is handled by `sentenceQuality`, not here: measured on staging, a distinct-character threshold mostly caught
 * short full sentences (ただの無謀だ, 少年よ 戦え), and the content-word rule already covers bare words.
 */
export function isFragment(tokens: readonly DifficultyToken[] | null | undefined, text: string): boolean | undefined {
  if (!tokens?.length) return undefined;

  const lemmas = new Set<string>();
  let last: DifficultyToken | undefined;
  for (const raw of tokens) {
    const token = stripBidi(raw);
    if (isContentToken(token)) lemmas.add(token.d);
    if (token.kind !== 'symbol' && token.p !== '補助記号' && token.p !== '記号' && token.s.trim()) last = token;
  }
  if (lemmas.size < MIN_CONTENT_WORDS) return true;

  const plain = text.replace(BIDI_MARKS, '');
  if (TRAILING_COMMA.test(plain)) return true;
  if (!last || FINISHED_UTTERANCE.test(plain)) return false;
  if (isParticle(last) && DANGLING_PARTICLES.has(last.s)) return true;
  if (!TRAILING_OFF.test(plain)) return false;
  // Only a true particle (助詞): an auxiliary such as だ or です finishes the sentence (冷気だ...).
  return last.p === '助詞' ? !SENTENCE_FINAL_PARTICLES.has(last.s) : NOUN_POS.has(last.p);
}

/** How well a segment works as an example sentence, the first key of the difficulty sorts (lower first).
 * `GOOD`: a full sentence of ordinary length. `MARGINAL`: a full sentence that is very short (先生これ, 食べていい),
 * very long (several sentences, a transcript paragraph) or stuttered (せせせせ... 先生!, 猫 猫... 猫...).
 * `FRAGMENT`: see `isFragment`. */
export const SENTENCE_QUALITY = { GOOD: 0, MARGINAL: 1, FRAGMENT: 2 } as const;
export type SentenceQuality = (typeof SENTENCE_QUALITY)[keyof typeof SENTENCE_QUALITY];

/** Ordinary length in UTF-16 units of the trimmed text, the count the indexed `characterCount` uses. On staging 73% of segments are
 * full sentences within it; most shorter ones are two-word lines, most longer ones several sentences in one segment,
 * which filled "hardest first" because their words and conjugations add up. */
export const GOOD_LENGTH = { min: 8, max: 40 } as const;
/** The same kana or kanji three times in a row: a stutter (せせせ, あああ) or a drawn-out cry. ー is not a letter. */
const STUTTER = /([\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}])\1\1/u;
const MAX_LEMMA_REPEATS = 2;

function repeatsAWord(tokens: readonly DifficultyToken[]): boolean {
  const counts = new Map<string, number>();
  for (const raw of tokens) {
    const token = stripBidi(raw);
    if (!isContentToken(token)) continue;
    const count = (counts.get(token.d) ?? 0) + 1;
    if (count > MAX_LEMMA_REPEATS) return true;
    counts.set(token.d, count);
  }
  return false;
}

/** The segment's `SentenceQuality`; undefined without tokens, like `isFragment`. */
export function sentenceQuality(
  tokens: readonly DifficultyToken[] | null | undefined,
  text: string,
): SentenceQuality | undefined {
  const fragment = isFragment(tokens, text);
  if (fragment === undefined || !tokens) return undefined;
  if (fragment) return SENTENCE_QUALITY.FRAGMENT;

  const plain = text.replace(BIDI_MARKS, '').trim();
  const outOfRange = plain.length < GOOD_LENGTH.min || plain.length > GOOD_LENGTH.max;
  return outOfRange || STUTTER.test(plain) || repeatsAWord(tokens) ? SENTENCE_QUALITY.MARGINAL : SENTENCE_QUALITY.GOOD;
}

/** Builds the lookup from `WordFrequency` rows, keeping the lowest rank per key and capping names at
 * `NAME_RANK_CAP`. */
export function buildRankLookup(
  rows: Iterable<{ rank: number; word: string; form: string | null; isName?: boolean }>,
): RankLookup {
  const word = new Map<string, number>();
  const form = new Map<string, number>();
  const keep = (map: Map<string, number>, key: string, rank: number) => {
    const previous = map.get(key);
    if (previous === undefined || rank < previous) map.set(key, rank);
  };
  for (const row of rows) {
    const rank = row.isName ? Math.min(row.rank, NAME_RANK_CAP) : row.rank;
    keep(word, row.word, rank);
    keep(form, row.word, rank);
    if (row.form) keep(form, row.form, rank);
  }
  return { word, form };
}
