import { describe, it, expect } from 'vitest';
import { enrichTokens, furiganaOf, tokensToAnkiFurigana, type SlimToken } from './tokenEnrichment';

// This file used to be mostly grouping tests: fifteen cases proving the frontend
// could rejoin 焼け + た into 焼けた, and 待っ + て + い + た into 待っていた, out of
// the token stream SudachiPy handed over. Shirabe parses the corpus now and does
// that upstream, so a token arrives already being the word a reader looks up and
// there is nothing here left to reassemble.
//
// Those cases did not go to waste. They were replayed against Shirabe's tokenizer
// to check the swap did not change how the corpus reads, and every one of them
// groups the same way. What is left to test here is the presentation this file
// still owns: labels, ruby, and which tokens a search highlighted.

// Shirabe tokens: already grouped, readings in katakana, ruby aligned, `wid`
// pointing at the entry. Offsets are UTF-16, matching JavaScript string indices.
const INFLECTED: SlimToken = {
  s: '焼けた',
  d: '焼ける',
  r: 'ヤケタ',
  b: 0,
  e: 3,
  p: '動詞',
  p4: '下一段-カ行',
  cf: '連用形-一般',
  kind: 'inflected',
  wid: '焼ける-やける',
  f: [{ t: '焼', r: 'や' }, { t: 'けた' }],
  parts: [
    { s: '焼け', b: 0, e: 2 },
    { s: 'た', b: 2, e: 3 },
  ],
};
const FRYPAN: SlimToken = {
  s: 'フライパン',
  d: 'フライパン',
  r: 'フライパン',
  b: 3,
  e: 8,
  p: '名詞',
  p1: '普通名詞',
  kind: 'word',
};
const NI: SlimToken = { s: 'に', d: 'に', r: 'ニ', b: 8, e: 9, p: '助詞', p1: '格助詞', kind: 'function' };
const YAKETA: SlimToken[] = [INFLECTED, FRYPAN, NI];

describe('enrichTokens', () => {
  it('returns an empty array for empty input', () => {
    expect(enrichTokens([])).toEqual([]);
  });

  it('presents a token as itself, because it already is the word', () => {
    const [yaketa] = enrichTokens(YAKETA);

    expect(yaketa?.displaySurface).toBe('焼けた');
    expect(yaketa?.dictForm).toBe('焼ける');
    expect(yaketa?.searchText).toBe('焼ける');
    expect(yaketa?.reading).toBe('やけた');
  });

  it('labels the parts of speech it is given', () => {
    const [yaketa, frypan] = enrichTokens(YAKETA);

    expect(yaketa?.posEn).toBe('Verb');
    expect(yaketa?.conjClassJa).toBe('下一段');
    expect(frypan?.posEn).toBe('Noun');
  });

  it('labels the two parts of speech Shirabe emits that the old table lacked', () => {
    const [expression, adjectival] = enrichTokens([
      { s: 'について', d: 'について', r: 'ニツイテ', b: 0, e: 4, p: '連語', kind: 'expression' },
      { s: '静か', d: '静か', r: 'シズカ', b: 4, e: 6, p: '形状詞', kind: 'word' },
    ]);

    expect(expression?.posEn).toBe('Expression');
    expect(adjectival?.posEn).toBe('Adjectival noun');
  });
});

describe('furigana', () => {
  it('uses the ruby the token carries, kanji only', () => {
    expect(furiganaOf(INFLECTED)).toEqual([
      { text: '焼', reading: 'や' },
      { text: 'けた', reading: '' },
    ]);
  });

  it('renders a token with no ruby as itself', () => {
    expect(furiganaOf(FRYPAN)).toEqual([{ text: 'フライパン', reading: '' }]);
  });

  it('writes Anki notation from the aligned ruby', () => {
    expect(tokensToAnkiFurigana('焼けたフライパンに', YAKETA)).toBe('焼[や]けたフライパンに');
  });
});

describe('highlight matching', () => {
  it('marks a token the search covered', () => {
    const enriched = enrichTokens(YAKETA, '<em>焼けた</em>フライパンに');

    expect(enriched[0]?.matchType).toBe('match');
    expect(enriched[0]?.highlightRanges).toEqual([]);
  });

  it('leaves unrelated tokens alone', () => {
    const enriched = enrichTokens(YAKETA, '<em>焼けた</em>フライパンに');

    expect(enriched[1]?.matchType).toBe('none');
  });

  // Elasticsearch analyzes textJa with its own embedded Sudachi, which cuts words
  // where we do not: it can match 焼け inside our 焼けた. That is not a whole-word
  // match and must not render as one, so it is reported separately along with the
  // part that actually matched, in the token's own characters.
  it('reports a match that lands inside a token, with the part that matched', () => {
    const enriched = enrichTokens(YAKETA, '<em>焼け</em>たフライパンに');

    expect(enriched[0]?.matchType).toBe('partial');
    expect(enriched[0]?.highlightRanges).toEqual([{ start: 0, end: 2 }]);
  });
});
