import { describe, expect, it } from 'vitest';
import { stripHalfWidthSpaces } from '../../scripts/strip-wakati-spaces';

describe('stripHalfWidthSpaces', () => {
  it('closes the morpheme boundaries a wakati-segmented ingest left behind', () => {
    expect(stripHalfWidthSpaces('何 か の 間違い でしょ う')).toBe('何かの間違いでしょう');
    expect(stripHalfWidthSpaces('会社 疲れ の 新人 サラリーマン って ところ かー')).toBe(
      '会社疲れの新人サラリーマンってところかー',
    );
  });

  // The one distinction this script rests on. U+3000 is real Japanese
  // typography and appears in clean media across the corpus; the repaired lines
  // use it correctly alongside the noise, so a regex that stopped
  // distinguishing the two would quietly corrupt what it was meant to fix.
  it('leaves full-width U+3000 alone', () => {
    expect(stripHalfWidthSpaces('近い ぞ ! !　誰か い ない の か ! ?')).toBe('近いぞ!!　誰かいないのか!?');
    expect(stripHalfWidthSpaces('何あれ?　何あれ')).toBe('何あれ?　何あれ');
  });

  // Japanese closes the gap between a number and its unit, so the four lines in
  // this media with Latin/digit runs come out right rather than merely unharmed.
  it('closes Latin and digit runs the way Japanese writes them', () => {
    expect(stripHalfWidthSpaces('スクワット 100 回')).toBe('スクワット100回');
    expect(stripHalfWidthSpaces('身長 2 m 15 cm 体重 210 kg')).toBe('身長2m15cm体重210kg');
  });

  it('leaves already-clean content untouched', () => {
    expect(stripHalfWidthSpaces('フッどこの世界もカネ稼げるやつが勝ちなんだよ')).toBe(
      'フッどこの世界もカネ稼げるやつが勝ちなんだよ',
    );
  });
});
