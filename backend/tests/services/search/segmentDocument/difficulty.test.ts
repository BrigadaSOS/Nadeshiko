import { describe, it, expect } from 'vitest';
import {
  buildRankLookup,
  computeDifficulty,
  EXPRESSION_TIER_CAP,
  grammarBonus,
  isContentToken,
  isFragment,
  SENTENCE_QUALITY,
  sentenceQuality,
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
  { rank: 3, word: 'に', form: 'に' },
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

  it('reads a token as a number only when it starts with a digit or is kanji numerals throughout', () => {
    for (const number of ['十', '二十五', '百万', '3人', '２回']) expect(isContentToken(tok(number))).toBe(false);
    for (const word of ['十分', '万引き', '百合', '千切る', '千葉', '万一', '十人']) {
      expect(isContentToken(tok(word))).toBe(true);
    }
  });

  it('skips Latin-only tokens, which the list does not rank', () => {
    for (const latin of ['OK', 'LINE', 'A', 'ＯＫ']) expect(isContentToken(tok(latin))).toBe(false);
    expect(isContentToken(tok('Tシャツ'))).toBe(true);
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

  it('does not repair a word down to a single kana that happens to be a particle', () => {
    // にぃ ("big brother") minus its small ぃ is に, rank 3.
    expect(lookupRank(tok('にぃ'), lookup)).toBeUndefined();
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

  it('flags a line that trails off right after a particle that does not end sentences', () => {
    const endingOn = (last: ReturnType<typeof tok>) => [tok('会長'), particle('の'), tok('体'), last];
    expect(isFragment(endingOn(particle('って')), '会長の体って...')).toBe(true);
    expect(isFragment(endingOn(particle('は')), '会長の体は-')).toBe(true);
    // の right after a noun is the possessive.
    expect(isFragment([tok('これ'), particle('は'), tok('先生'), particle('の')], 'これは先生の...')).toBe(true);
  });

  it('recognises the usual ellipsis and dash spellings, also before 。 or a closing bracket', () => {
    const cut = [tok('会長'), particle('の'), tok('体'), particle('って')];
    for (const ending of ['..', '...', '…', '‥', '・・・', '。。。', '-', '－', '―', '—', '–', '─', '…。', '...」']) {
      expect(isFragment(cut, `会長の体って${ending}`), ending).toBe(true);
    }
    expect(isFragment(cut, '会長の体って。')).toBe(false);
  });

  it('keeps conjunctive and sentence-final particles before an ellipsis, also drawn out', () => {
    const verbThen = (s: string, d = s) => [tok('こと'), tok('ある', { p: '動詞' }), { ...particle(s), d }];
    expect(isFragment(verbThen('けど'), '聞きたいことがあるんだけど...')).toBe(false);
    expect(isFragment(verbThen('から'), 'ことがあるから…')).toBe(false);
    expect(isFragment(verbThen('ねぇ', 'ね'), '綺麗なことがあるねぇ...')).toBe(false);
    expect(isFragment(verbThen('の'), 'どうしたことがあるの...')).toBe(false);
  });

  it('keeps a finished sentence that trails off, and a long vowel at the end', () => {
    const finished = [tok('冷気'), { ...particle('だ'), p: '助動詞' }];
    expect(isFragment([tok('凍る', { p: '動詞' }), ...finished], '凍りつきそうな冷気だ...')).toBe(false);
    expect(isFragment([tok('元気'), tok('いる', { p: '動詞' }), particle('ね')], '元気でいるね...')).toBe(false);
    expect(isFragment([tok('行く', { p: '動詞' }), tok('今'), particle('よ')], '今 行くよ...')).toBe(false);
    expect(isFragment([tok('皆さん'), tok('さようなら')], '皆さん さようならー')).toBe(false);
    expect(isFragment([tok('会長'), particle('の'), tok('体'), particle('って')], '会長の体って...?')).toBe(false);
  });

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

  it('keeps a short full sentence, however few characters it has', () => {
    expect(
      isFragment([tok('無謀', { p: '形状詞' }), tok('ただ'), { ...particle('だ'), p: '助動詞' }], 'ただの無謀だ'),
    ).toBe(false);
  });

  it('keeps an inverted or elliptical line that ends on a particle and a question or exclamation mark', () => {
    const question = [tok('味方'), tok('なぜ', { p: '副詞' }), particle('を'), punctuation('?')];

    expect(isFragment(question, 'なぜ味方を?')).toBe(false);
    expect(isFragment([tok('学校'), tok('明日'), particle('で'), punctuation('!')], '明日 学校で!')).toBe(false);
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

describe('grammarBonus', () => {
  const verb = (d: string, s: string) => tok(d, { s, p: '動詞', kind: 'inflected' });

  it('is zero for dictionary forms and plain words', () => {
    expect(grammarBonus([tok('猫'), verb('食べる', '食べる')])).toBe(0);
  });

  it('grows with how far each conjugation stretches the word', () => {
    expect(grammarBonus([verb('食べる', '食べた')])).toBe(0);
    expect(grammarBonus([verb('食べる', '食べさせられた')])).toBe(Math.round(4 * 1.7));
  });

  it('sums over the sentence and never goes negative for a kana surface of a kanji lemma', () => {
    expect(grammarBonus([verb('食べる', '食べさせた'), verb('分かる', 'わかった')])).toBe(Math.round(3 * 1.7));
  });

  it('reads polite endings as plain ones, so politeness is not counted as grammar', () => {
    const bonus = (d: string, s: string) => grammarBonus([verb(d, s)]);
    expect(bonus('食べる', '食べました')).toBe(bonus('食べる', '食べた'));
    expect(bonus('食べる', '食べます')).toBe(0);
    expect(bonus('行く', '行きました')).toBe(bonus('行く', '行った'));
    expect(bonus('食べる', '食べませんでした')).toBe(bonus('食べる', '食べなかった'));
    expect(bonus('食べる', '食べませんでした')).toBeLessThan(bonus('食べる', '食べさせられた'));
    expect(bonus('思う', '思っていました')).toBe(bonus('思う', '思っていた'));
  });
});

describe('computeDifficulty with grammar', () => {
  it('raises the second place without changing the hardest word', () => {
    const plain = [tok('魔法'), tok('食べる', { p: '動詞' })];
    const conjugated = [tok('魔法'), tok('食べる', { s: '食べさせられた', p: '動詞', kind: 'inflected' })];

    expect(computeDifficulty(plain, lookup)).toBe(rankTier(5000) * 64 + rankTier(197));
    expect(computeDifficulty(conjugated, lookup)).toBe(rankTier(5000) * 64 + rankTier(197) + Math.round(4 * 1.7));
  });

  it('keeps the grammar term inside the hardest word’s group', () => {
    const long = tok('食べる', { s: '食べさせられなかったでしょうか', p: '動詞', kind: 'inflected' });

    // 駆ける (rank 9,000) is the hardest word; 魔法 second plus a long conjugation would pass it, and is capped.
    expect(computeDifficulty([tok('駆ける', { p: '動詞' }), tok('魔法'), long], lookup)).toBe(
      rankTier(9000) * 64 + MAX_RANK_TIER,
    );
  });
});

describe('sentenceQuality', () => {
  const words = (...lemmas: string[]) => lemmas.map((d) => tok(d));

  it('is good for a full sentence of ordinary length', () => {
    expect(sentenceQuality(words('猫', '魔法', '使う'), '猫がいつも魔法を使う')).toBe(SENTENCE_QUALITY.GOOD);
  });

  it('is marginal for a full sentence that is very short or very long', () => {
    expect(sentenceQuality(words('先生', 'これ'), '先生これ')).toBe(SENTENCE_QUALITY.MARGINAL);
    expect(sentenceQuality(words('猫', '魔法'), '猫が'.repeat(21))).toBe(SENTENCE_QUALITY.MARGINAL);
    // Bidi marks and surrounding spaces do not count.
    expect(sentenceQuality(words('猫', '魔法', '使う'), '\u200e 猫がいつも魔法を使う ')).toBe(SENTENCE_QUALITY.GOOD);
  });

  it('is marginal for a stutter or a word said three times', () => {
    expect(sentenceQuality(words('先生', 'せせせ'), 'せせせせ... 先生！ 待って')).toBe(SENTENCE_QUALITY.MARGINAL);
    expect(sentenceQuality(words('猫', '猫', '猫', 'が'), 'ね 猫が... 猫 猫...が')).toBe(SENTENCE_QUALITY.MARGINAL);
    expect(sentenceQuality(words('猫', '猫', '魔法'), '猫と猫が魔法を使う')).toBe(SENTENCE_QUALITY.GOOD);
  });

  it('counts letters and digits only, from 6 to 40', () => {
    const two = words('先生', 'これ');
    expect(sentenceQuality(two, '先生、これ!!!!')).toBe(SENTENCE_QUALITY.MARGINAL);
    expect(sentenceQuality(two, 'あいうえお')).toBe(SENTENCE_QUALITY.MARGINAL);
    expect(sentenceQuality(two, 'あいうえおか')).toBe(SENTENCE_QUALITY.GOOD);
    expect(sentenceQuality(two, 'あいうえおか?')).toBe(SENTENCE_QUALITY.GOOD);
    expect(sentenceQuality(two, 'あいうえ'.repeat(10))).toBe(SENTENCE_QUALITY.GOOD);
    expect(sentenceQuality(two, `${'あいうえ'.repeat(10)}お`)).toBe(SENTENCE_QUALITY.MARGINAL);
    expect(sentenceQuality(two, `${'あいうえ'.repeat(10)}。 !!`)).toBe(SENTENCE_QUALITY.GOOD);
  });

  it('is marginal for a line trailing off after a noun, often a full noun sentence', () => {
    expect(sentenceQuality([tok('本当'), tok('ごめん')], '本当に本当にごめん…')).toBe(SENTENCE_QUALITY.MARGINAL);
    expect(sentenceQuality([tok('本当'), tok('ごめん')], '本当に本当にごめん')).toBe(SENTENCE_QUALITY.GOOD);
    const name = [tok('アルフォンス'), tok('来る', { p: '動詞' }), tok('様', { p: '接尾辞' })];
    expect(sentenceQuality(name, 'もう来たよ アルフォンス様...')).toBe(SENTENCE_QUALITY.MARGINAL);
  });

  it('does not take a long vowel or a doubled 々 for a stutter', () => {
    expect(sentenceQuality(words('すごい', '本当'), '本当にすごーーーい')).toBe(SENTENCE_QUALITY.GOOD);
    expect(sentenceQuality(words('人々', '時々'), '人々は時々笑う')).toBe(SENTENCE_QUALITY.GOOD);
  });

  it('is a fragment for a fragment, and undefined without tokens', () => {
    expect(sentenceQuality(words('大丈夫'), '大丈夫だよ、きっとね')).toBe(SENTENCE_QUALITY.FRAGMENT);
    expect(sentenceQuality(null, '猫が魔法を使う')).toBeUndefined();
  });
});
