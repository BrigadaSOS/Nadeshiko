/** Estimated sentence difficulty for the `DIFFICULTY_ASC` / `DIFFICULTY_DESC` sorts (#542), from how rare a sentence's
 * words are on the anime frequency list in `WordFrequency`. Pure: the indexer loads the rank lookup once and passes it in. It
 * measures vocabulary rarity only, not grammar, speech speed or what a given reader knows. The rule and the numbers
 * behind it are in `docs/search-difficulty.md`. */

import type { SlimToken } from '@app/models/Segment';

/** Ranks from the frequency list, lowest rank kept per key. `word` is keyed by the spelling; `form` by the kana form,
 * used only for a kana-written token. */
export interface RankLookup {
  word: ReadonlyMap<string, number>;
  form: ReadonlyMap<string, number>;
}

type DifficultyToken = Pick<SlimToken, 's' | 'd' | 'r' | 'p' | 'kind' | 'parts'>;

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
const BIDI_MARKS = /[‎‏‪-‮]/g;
const HAS_LETTER = /\p{L}/u;
const KANA_ONLY = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u;
const NUMERAL = /^[0-9０-９.,万億千百十]+/;
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

/** A word a reader has to know: not a particle, auxiliary, punctuation, interjection or number. */
export function isContentToken(token: DifficultyToken): boolean {
  if (token.p === INTERJECTION_POS) return false;
  if (!HAS_LETTER.test(token.d)) return false;
  if (NUMERAL.test(token.d) || NUMERAL.test(token.s)) return false;
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
 * `hardest * 64 + second` over the two hardest DISTINCT lemmas (second = 0 with a single content word), 0–4030.
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
  return hardest * 64 + second;
}

/** Case and binding particles a line does not end on unless it was cut mid-sentence across subtitle cues
 * (猫が… / これは). Sentence-final particles (よ, ね, か, の) and conjunctive ones (から, けど, て) end real lines. */
const DANGLING_PARTICLES = new Set(['が', 'を', 'に', 'へ', 'で', 'と', 'は', 'も']);
const MIN_CONTENT_WORDS = 2;
/** A line ending in a question or exclamation mark is a finished utterance even after a particle: an inverted or
 * elliptical sentence (何を? / なんだ… これは! / 学校で!), not one cut across cues. */
const FINISHED_UTTERANCE = /[?？!！][\s」』）)"]*$/;
const TRAILING_COMMA = /[、，,]\s*$/;

/**
 * Whether a line is too small or too cut off to be a useful example: fewer than two distinct content words (大丈夫,
 * 先生!), or ending on a comma or on a dangling particle without a closing ? or !. The difficulty sorts put these
 * after every complete sentence, so "easiest first" does not open on hundreds of one-word lines. Undefined without
 * tokens: such a segment has no difficulty either and sorts last.
 *
 * There is deliberately no minimum length: measured on staging, a distinct-character threshold mostly caught short
 * full sentences (ただの無謀だ, 少年よ 戦え), and the content-word rule already covers bare words.
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

  if (TRAILING_COMMA.test(text)) return true;
  if (!last || FINISHED_UTTERANCE.test(text)) return false;
  return (last.kind === 'function' || last.p === '助詞') && DANGLING_PARTICLES.has(last.s);
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
