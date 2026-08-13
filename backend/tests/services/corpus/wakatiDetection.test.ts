import { describe, expect, it } from 'vitest';
import {
  assessWakati,
  describeWakati,
  emptyTally,
  tallyLine,
  summarize,
  MIN_SPACED_LINES,
} from '../../../app/services/corpus/wakatiDetection';

/**
 * Both fixtures are real production lines, copied from the corpus survey that
 * found this. Invented ones would be worth much less: the whole question is
 * whether the threshold separates a wakati source from the messiest LEGITIMATE
 * spacing the corpus actually contains, and only real lines can answer that.
 */

/** One Punch Man, before `strip-wakati-spaces.ts` ran against production. */
const WAKATI_LINES = [
  '残念 だ が 俺 は 命 を かけ てる わけ じゃ ない',
  '私 は 人間 ども が 環境 汚染 を 繰り返す ことに よって 生まれ た　ワクチン マン だ !',
  'この 速さ に つい て こ れる か ?',
  '構成員 の 頭 は スキン ヘッド で 統 ー さ れ ー',
  '頼ん で おい た 調査 の ほう は どうなってる ?',
  '早速 各 ポイント の ー　調査 報告 が き て い ます',
  'ふんっ 深海 王 め 逃げ られ た か',
  'S 級 ヒーロー ぷりぷり プリズナー',
  'いっぺん 退治 さ れ て 頭 でも 冷や せよ',
  'そこ で 待ってろ え ?',
  '俺 も フルパワー を ぶつける 実験台 が 欲しかった ところ だ !',
  'どうやった か 知ら ない けど 単独 で 乗り込ん で た の ?',
  'おう い たい た ! !',
  'だが 仕事 は しばらく おあずけ だ ー',
  '少し は 骨 が あり そう だ な',
  'そいつ の 打撃 を 身体 で 受け て は いけません !',
  'だが 今 から 言う 話 を 聞い た 者 は 逃がす わけ に は いか なく なる ー',
  'ほら 最初 から 私 が 行け ば よかった じゃ ない !',
  'お前 見 て みろ よ',
  '近い ぞ ! !　誰か い ない の か ! ?',
  'イナズマックス と スマイル マン が 向かった と の 連絡 が あり まし た !',
  '災害 レベル の 設定 を 急げ !',
  'それ らしき 気配 は 感じ ない なー',
  'そして 俺 は 正義 の サイボーグ として 生まれ変わり ー',
];

/**
 * Clean media, deliberately picked to be the hardest possible negative: these
 * are the lines the corpus survey flagged as "spaced" in Kimi ni Todoke, NARUTO,
 * CLANNAD and friends, including the dash-dialogue ones (` うん - そうか`) whose
 * ratio is as low as legitimate subtitles ever go. A fixture of ordinary long
 * lines would pass the threshold without proving anything.
 */
const CLEAN_LINES = [
  'ええやろ 別に 外 あっついし',
  'いや 顔 見たら また むかつくかもね',
  ' こわ~い! - はよ入ろ',
  '俺 今日 見たよ 捨て犬だけど',
  ' 凛太郎! - がっ!',
  'おっ 100連勝 阻止 おめでとう 龍',
  ' それで この人が... - あっ!',
  ' うん - そうか',
  'はよ 服着ろや 蛮族か お前は',
  '悪い 俺 飲み物 取ってくる',
  'おっ 行く! で どこ?',
  'おお いいね 茶髪 茶髪',
  'もう きっとサスケ君を止めることが...　救うことができるのは...',
  '机で じっとなんか してられっかよ 。なぁ 赤丸',
  'ちゃんと わかってくれたかな',
  'いいだろう とりあえず遊んでやる',
  'その上 封印の書も手の内にあるとなると',
  'どっちが上か 試してやるぜ!',
  'こ こんにちは',
  'じゃあの わしは また 情報収集に行くからの 。',
  '相変わらず 分かりにくいしゃべりしやがって。この虫オタク!',
  '私 そんな夏休み 知らないから',
  'サスケは絶対 俺が連れて帰る!　一生の約束だってばよ!',
  'まあ そっちは もう少し　太らせてからでもいいだろう。',
];

describe('assessWakati', () => {
  it('flags a morpheme-segmented batch', () => {
    const assessment = assessWakati(WAKATI_LINES);

    expect(assessment.isWakati).toBe(true);
    // Production measured this media at 1.91 across all 3,149 lines.
    expect(assessment.meanChunkChars).toBeLessThan(2.5);
  });

  it('leaves the corpus’s messiest legitimate spacing alone', () => {
    const assessment = assessWakati(CLEAN_LINES);

    expect(assessment.isWakati).toBe(false);
    // Comfortably clear of the 3.0 threshold even with the dash-dialogue lines
    // dragging it well below the 5.6 this media scores over its full corpus.
    expect(assessment.meanChunkChars).toBeGreaterThan(4);
  });

  /**
   * The reason MIN_SPACED_LINES exists. These are real wakati lines, so the
   * ratio is genuinely damning -- and still not enough to act on, because a
   * handful of short exclamations can average anything and rejecting a whole
   * episode on five lines is not a trade worth making.
   */
  it('will not judge a batch too small to carry the signal', () => {
    const few = WAKATI_LINES.slice(0, 5);
    const assessment = assessWakati(few);

    expect(assessment.spacedLines).toBeLessThan(MIN_SPACED_LINES);
    expect(assessment.meanChunkChars).toBeLessThan(3);
    expect(assessment.isWakati).toBe(false);
  });

  /**
   * U+3000 is real Japanese typography and appears in 172k segments of clean
   * corpus. Counting it would flag the corpus rather than the outlier.
   */
  it('ignores full-width U+3000 entirely', () => {
    const ideographic = Array.from({ length: 40 }, () => '近い　ぞ　誰か　い　ない　の　か');
    const assessment = assessWakati(ideographic);

    expect(assessment.spacedLines).toBe(0);
    expect(assessment.meanChunkChars).toBe(0);
    expect(assessment.isWakati).toBe(false);
  });

  it('counts only the lines that carry a space', () => {
    const assessment = assessWakati(['お前 見 て みろ よ', 'クリーンな行', '']);

    expect(assessment.totalLines).toBe(3);
    expect(assessment.spacedLines).toBe(1);
    // お前|見|て|みろ|よ is 7 characters, 4 spaces -> 5 chunks.
    expect(assessment.meanChunkChars).toBeCloseTo(7 / 5);
  });

  it('reports an empty batch without dividing by zero', () => {
    const assessment = assessWakati([]);

    expect(assessment).toEqual({ totalLines: 0, spacedLines: 0, meanChunkChars: 0, isWakati: false });
  });
});

describe('tallyLine', () => {
  // The audit script streams 1.3M segments through the accumulator rather than
  // buffering them per media, so it must land on the same answer as the guard.
  it('accumulates to the same assessment as the array form', () => {
    const tally = emptyTally();
    for (const line of WAKATI_LINES) tallyLine(tally, line);

    expect(summarize(tally)).toEqual(assessWakati(WAKATI_LINES));
  });
});

describe('describeWakati', () => {
  it('quotes the numbers it judged on', () => {
    expect(describeWakati(assessWakati(WAKATI_LINES))).toMatch(
      /^24 of 24 lines average 1\.\d characters between spaces\. This subtitle source looks morpheme-segmented \(wakati-gaki\); ingest the unsegmented text\.$/,
    );
  });
});
