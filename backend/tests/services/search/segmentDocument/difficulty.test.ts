import { describe, it, expect } from 'vitest';
import {
  buildRankLookup,
  computeDifficulty,
  EXPRESSION_TIER_CAP,
  isContentToken,
  isFragment,
  lookupRank,
  MAX_DIFFICULTY,
  MAX_RANK_TIER,
  NAME_RANK_CAP,
  rankTier,
  UNKNOWN_TIER,
} from '@app/services/search/segmentDocument/difficulty';

/** Pure scoring for the difficulty sort: which tokens count, how a rank becomes a tier, and how the two hardest
 * distinct words combine into one sortable number. */

const lookup = buildRankLookup([
  { rank: 1, word: 'の', form: 'の' },
  { rank: 28, word: '私', form: 'わたし' },
  { rank: 13, word: 'する', form: 'する' },
  { rank: 100, word: '猫', form: 'ねこ' },
  { rank: 197, word: '食べる', form: 'たべる' },
  { rank: 400, word: 'もしかして', form: 'もしかして' },
  { rank: 465, word: '先生', form: 'せんせい' },
  { rank: 1000, word: '勝つ', form: 'かつ' },
  { rank: 5000, word: '魔法', form: 'まほう' },
  { rank: 6000, word: 'さくら', form: 'さくら' },
  { rank: 9000, word: '駆ける', form: 'かける' },
  { rank: 45195, word: 'のだ', form: 'のだ' },
  { rank: 30, word: 'ある', form: 'ある' },
  { rank: 31, word: 'なる', form: 'なる' },
  // A duplicate key keeps its lowest rank: the list has chunks like だった next to their words.
  { rank: 50000, word: '猫', form: 'ねこ' },
]);

const tok = (d: string, overrides: Partial<Parameters<typeof isContentToken>[0]> = {}) => ({
  s: d,
  d,
  r: '',
  p: '名詞',
  kind: 'word',
  ...overrides,
});

const particle = (s: string) => tok(s, { p: '助詞', kind: 'function' });
const punctuation = (s: string) => tok(s, { p: '補助記号', kind: 'symbol' });

describe('rankTier', () => {
  it.each([
    [1, 0],
    [2, 4],
    [16, 16],
    [1000, 39],
    [10000, 53],
    [46340, 61],
    [46341, MAX_RANK_TIER],
    [10_000_000, MAX_RANK_TIER],
  ])('rank %i → tier %i', (rank, tier) => {
    expect(rankTier(rank)).toBe(tier);
  });

  it('treats a nonsensical rank as the most common word rather than producing NaN', () => {
    expect(rankTier(0)).toBe(0);
  });
});

describe('isContentToken', () => {
  it('skips particles, auxiliaries and punctuation', () => {
    expect(isContentToken(particle('が'))).toBe(false);
    expect(isContentToken(punctuation('。'))).toBe(false);
  });

  it('falls back to the UniDic part of speech for tokens parsed before `kind` existed', () => {
    expect(isContentToken({ s: 'だ', d: 'だ', r: 'ダ', p: '助動詞' })).toBe(false);
    expect(isContentToken({ s: '猫', d: '猫', r: 'ネコ', p: '名詞' })).toBe(true);
  });

  it('skips interjections, numbers and letterless "nouns"', () => {
    expect(isContentToken(tok('うう', { p: '感動詞' }))).toBe(false);
    expect(isContentToken(tok('1', { s: '1本', kind: 'counter' }))).toBe(false);
    expect(isContentToken(tok('➨'))).toBe(false);
  });
});

describe('lookupRank', () => {
  it('matches the lemma, keeping the lowest rank of a duplicated key', () => {
    expect(lookupRank(tok('猫'), lookup)).toBe(100);
  });

  it('reads a kana-written word by its reading, but never a kanji word by its homophone', () => {
    expect(lookupRank(tok('ネコ', { r: 'ネコ' }), lookup)).toBe(100);
    expect(lookupRank(tok('根子', { r: 'ネコ' }), lookup)).toBeUndefined();
  });

  it('takes the easier of the whole and its parts for a grouped token', () => {
    expect(
      lookupRank(
        tok('猫魔法', {
          kind: 'compound',
          parts: [
            { s: '猫', b: 0, e: 1 },
            { s: '魔法', b: 1, e: 3 },
          ],
        }),
        lookup,
      ),
    ).toBe(5000);
  });

  it('repairs elongations, honorifics and potential verbs', () => {
    expect(lookupRank(tok('ねこー'), lookup)).toBe(100);
    expect(lookupRank(tok('さくらちゃん'), lookup)).toBe(6000);
    expect(lookupRank(tok('勝てる', { s: '勝てない', p: '動詞', kind: 'inflected' }), lookup)).toBe(1000);
  });

  it('maps the parser’s known bad lemmas', () => {
    expect(lookupRank(tok('なた', { s: 'なった', p: '動詞' }), lookup)).toBe(31);
    expect(lookupRank(tok('あた', { s: 'あった', p: '動詞' }), lookup)).toBe(30);
  });

  it('leaves a character name unknown', () => {
    expect(lookupRank(tok('ルーデウス'), lookup)).toBeUndefined();
  });
});

describe('computeDifficulty', () => {
  it('is undefined without tokens, so the segment sorts last', () => {
    expect(computeDifficulty(null, lookup)).toBeUndefined();
    expect(computeDifficulty([], lookup)).toBeUndefined();
  });

  it('is undefined when only particles and punctuation remain', () => {
    expect(computeDifficulty([particle('ね'), punctuation('！')], lookup)).toBeUndefined();
  });

  it('is undefined when the frequency list was never seeded, rather than calling every word unknown', () => {
    expect(computeDifficulty([tok('猫')], buildRankLookup([]))).toBeUndefined();
  });

  it('scores a single content word with a zero second tier', () => {
    expect(computeDifficulty([tok('猫'), particle('だ')], lookup)).toBe(rankTier(100) * 64);
  });

  it('combines the two hardest distinct lemmas, hardest first', () => {
    const tokens = [tok('私'), particle('は'), tok('猫'), particle('が'), tok('魔法'), punctuation('。')];

    expect(computeDifficulty(tokens, lookup)).toBe(rankTier(5000) * 64 + rankTier(100));
  });

  it('counts a repeated word once, so it cannot fill both places', () => {
    const tokens = [tok('魔法'), tok('魔法', { s: '魔法' }), tok('猫')];

    expect(computeDifficulty(tokens, lookup)).toBe(rankTier(5000) * 64 + rankTier(100));
  });

  it('lets two different words of the same tier fill both places', () => {
    const tokens = [tok('猫'), tok('ネコ', { r: 'ネコ' })];

    expect(computeDifficulty(tokens, lookup)).toBe(rankTier(100) * 64 + rankTier(100));
  });

  it('counts an unknown word as a rank-5,000 word, not the rarest', () => {
    // Mostly character names: rarer than 魔法 would wrongly make every name-heavy line the hardest.
    expect(UNKNOWN_TIER).toBe(rankTier(5000));
    expect(computeDifficulty([tok('猫'), tok('ルーデウス')], lookup)).toBe(UNKNOWN_TIER * 64 + rankTier(100));
    expect(computeDifficulty([tok('駆ける'), tok('ルーデウス')], lookup)).toBe(rankTier(9000) * 64 + UNKNOWN_TIER);
  });

  it('caps expressions, which the list ranks far rarer than the words in them', () => {
    const tokens = [tok('猫'), tok('のだ', { p: '連語', kind: 'expression' })];

    expect(computeDifficulty(tokens, lookup)).toBe(EXPRESSION_TIER_CAP * 64 + rankTier(100));
  });

  it('ignores bidi marks some subtitle files carry', () => {
    expect(computeDifficulty([tok('‎'), tok('‎猫')], lookup)).toBe(rankTier(100) * 64);
  });

  it('never exceeds an Elasticsearch short', () => {
    const rarest = buildRankLookup([
      { rank: 90000, word: '稀', form: 'まれ' },
      { rank: 95000, word: '珍', form: 'ちん' },
    ]);

    expect(computeDifficulty([tok('稀'), tok('珍')], rarest)).toBe(MAX_DIFFICULTY);
    expect(MAX_DIFFICULTY).toBeLessThanOrEqual(32767);
  });
});

describe('buildRankLookup', () => {
  it('caps a proper name at the same rank as an unlisted word, whether it is rarer or not', () => {
    const names = buildRankLookup([
      { rank: 9258, word: '田中', form: 'たなか', isName: true },
      { rank: 2954, word: 'でした', form: 'でした', isName: true },
      { rank: 9000, word: '駆ける', form: 'かける', isName: false },
    ]);

    expect(names.word.get('田中')).toBe(NAME_RANK_CAP);
    expect(names.form.get('たなか')).toBe(NAME_RANK_CAP);
    // A common entry the dictionaries happen to list as a name keeps its own, easier rank.
    expect(names.word.get('でした')).toBe(2954);
    expect(names.word.get('駆ける')).toBe(9000);
  });
});

describe('isFragment', () => {
  const sentence = [tok('猫'), particle('が'), tok('魔法'), particle('を'), tok('使う', { p: '動詞' })];

  it('is false for a full sentence', () => {
    expect(isFragment(sentence, '猫が魔法を使う')).toBe(false);
  });

  it('is undefined without tokens, like the difficulty itself', () => {
    expect(isFragment(null, '猫')).toBeUndefined();
    expect(isFragment([], '猫')).toBeUndefined();
  });

  it('flags a line with fewer than two distinct content words', () => {
    expect(isFragment([tok('大丈夫'), punctuation('！')], '大丈夫！')).toBe(true);
    expect(isFragment([tok('先生'), tok('先生')], '先生、先生')).toBe(true);
  });

  it('flags a line with fewer than six distinct characters', () => {
    expect(isFragment([tok('猫'), tok('犬')], '猫と犬')).toBe(true);
  });

  it('flags a line cut off on a case or binding particle, ignoring trailing punctuation', () => {
    const cut = [tok('猫'), particle('が'), tok('魔法'), particle('を'), punctuation('…')];

    expect(isFragment(cut, '猫が魔法を…')).toBe(true);
  });

  it('keeps a line that ends on a sentence-final or conjunctive particle', () => {
    expect(isFragment([...sentence, particle('よ')], '猫が魔法を使うよ')).toBe(false);
    expect(isFragment([...sentence, particle('から')], '猫が魔法を使うから')).toBe(false);
  });

  it('flags a line ending on a comma', () => {
    expect(isFragment([tok('猫'), particle('が'), tok('魔法'), tok('使う')], '猫が魔法使う、')).toBe(true);
  });
});
