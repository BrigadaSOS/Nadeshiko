import { describe, expect, test } from 'vitest';
import {
  bookChapterName,
  circledNumber,
  episodeLabel,
  episodeLabelKey,
  isAudiobook,
  parseChapterTitle,
} from '~/utils/media';

describe('episodeLabelKey', () => {
  test('an audiobook is split into chapters', () => {
    expect(isAudiobook({ category: 'AUDIOBOOK' })).toBe(true);
    expect(episodeLabelKey({ category: 'AUDIOBOOK' })).toBe('searchpage.main.labels.chapter');
  });

  test('everything else keeps episodes, including a missing media', () => {
    expect(episodeLabelKey({ category: 'ANIME' })).toBe('searchpage.main.labels.episode');
    expect(episodeLabelKey(null)).toBe('searchpage.main.labels.episode');
  });
});

describe('episodeLabel', () => {
  const t = (key: string, values?: Record<string, unknown>) => `${key}:${values?.number}`;

  test('an audiobook chapter is named as its book names it, not by its position in the audio', () => {
    // Episode 4 is the fourth track of the m4b; the book calls it chapter 3.
    expect(episodeLabel(t, { category: 'AUDIOBOOK' }, 4, '(3)つねに由比ヶ浜結衣はきょろきょろしている。')).toBe(
      '③ つねに由比ヶ浜結衣はきょろきょろしている。',
    );
  });

  test('an unnumbered chapter is just its title', () => {
    expect(episodeLabel(t, { category: 'AUDIOBOOK' }, 10, 'あとがき')).toBe('あとがき');
  });

  test('a chapter without a title, or a blank one, falls back to "Chapter N"', () => {
    expect(episodeLabel(t, { category: 'AUDIOBOOK' }, 4, null)).toBe('searchpage.main.labels.chapter:4');
    expect(episodeLabel(t, { category: 'AUDIOBOOK' }, 4, '  ')).toBe('searchpage.main.labels.chapter:4');
  });

  test('anime keeps "Episode N" even when its episode has a title', () => {
    expect(episodeLabel(t, { category: 'ANIME' }, 1, 'Pilot')).toBe('searchpage.main.labels.episode:1');
  });
});

describe('parseChapterTitle', () => {
  test.each([
    ['(1)とにかく比企谷八幡はくさっている。', 1, 'とにかく比企谷八幡はくさっている。'],
    ['（１２） 全角の括弧', 12, '全角の括弧'],
    ['① 丸数字', 1, '丸数字'],
    ['㉑ 二十一', 21, '二十一'],
    ['第1章 始まり', 1, '始まり'],
    ['第十二話　終わり', 12, '終わり'],
    ['第二十五章', 25, ''],
    ['Chapter 3: The Club', 3, 'The Club'],
    ['ch. 7 - Rain', 7, 'Rain'],
    ['2. ふたつめ', 2, 'ふたつめ'],
    ['３：みっつめ', 3, 'みっつめ'],
  ])('%s is chapter %i of the book', (title, number, name) => {
    expect(parseChapterTitle(title)).toEqual({ number, name });
  });

  test.each(['あとがき', 'プロローグ', 'Epilogue', '2001年宇宙の旅', '十人十色'])(
    '%s carries no chapter number',
    (title) => {
      expect(parseChapterTitle(title)).toEqual({ number: null, name: title });
    },
  );
});

describe('bookChapterName', () => {
  test('puts the book’s number in front as a circled numeral', () => {
    expect(bookChapterName('(8)そして比企谷八幡はかんがえる。')).toBe('⑧ そして比企谷八幡はかんがえる。');
    expect(bookChapterName('第3章')).toBe('③');
  });

  test('circles up to 50, then falls back to "N."', () => {
    expect(circledNumber(1)).toBe('①');
    expect(circledNumber(20)).toBe('⑳');
    expect(circledNumber(21)).toBe('㉑');
    expect(circledNumber(35)).toBe('㉟');
    expect(circledNumber(36)).toBe('㊱');
    expect(circledNumber(50)).toBe('㊿');
    expect(circledNumber(51)).toBe('51.');
  });
});
