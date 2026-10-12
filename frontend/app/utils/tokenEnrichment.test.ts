import { describe, it, expect } from 'vitest';
import { enrichTokens, furiganaOf, shortPos, tokensToAnkiFurigana, type SlimToken } from './tokenEnrichment';

// Shirabe owns token grouping; these tests cover frontend labels, ruby and highlighting.

// Already-grouped Shirabe tokens use katakana readings, aligned ruby and UTF-16 offsets matching JavaScript
// string indices.
const INFLECTED: SlimToken = {
  s: '焼けた',
  d: '焼ける',
  r: 'ヤケタ',
  b: 0,
  e: 3,
  p: '動詞',
  kind: 'inflected',
  posLabel: 'Verb',
  inflection: { labels: ['past'], base: '焼ける' },
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
  posLabel: 'Noun',
  kind: 'word',
};
const NI: SlimToken = { s: 'に', d: 'に', r: 'ニ', b: 8, e: 9, p: '助詞', kind: 'function' };
const YAKETA: SlimToken[] = [INFLECTED, FRYPAN, NI];

describe('enrichTokens', () => {
  it('returns an empty array for empty input', () => {
    expect(enrichTokens([])).toEqual([]);
  });

  it('presents a token as itself, because it already is the word', () => {
    const [yaketa] = enrichTokens(YAKETA);

    expect(yaketa?.displaySurface).toBe('焼けた');
    expect(yaketa?.dictForm).toBe('焼ける');
    expect(yaketa?.readingHiragana).toBe('やけた');
  });

  // Display hiragana and lookup katakana must remain separate to preserve homograph resolution.
  it('keeps the display reading and the lookup reading apart', () => {
    const [yaketa] = enrichTokens(YAKETA);

    expect(yaketa?.readingHiragana).toBe('やけた');
    expect(yaketa?.lookupRef.reading).toBe('ヤケタ');
  });

  // Lookup POS uses Shirabe's short vocabulary, not raw UniDic or the printable label.
  it('assembles everything the dictionary lookup asks by', () => {
    const [yaketa] = enrichTokens(YAKETA);

    expect(yaketa?.lookupRef).toEqual({
      lemma: '焼ける',
      surface: '焼けた',
      reading: 'ヤケタ',
      pos: 'verb',
    });
    expect(yaketa?.posLabel).toBe('Verb');
  });

  it('prints the part of speech the token carries', () => {
    const [yaketa, frypan] = enrichTokens(YAKETA);

    expect(yaketa?.posLabel).toBe('Verb');
    expect(frypan?.posLabel).toBe('Noun');
  });

  // The chain, not one name: calling 食べさせられた a past tense would be true of
  // its last step only. An ambiguous step keeps its ambiguity.
  it('carries the inflection chain in order', () => {
    const [stacked] = enrichTokens([
      {
        s: '食べさせられた',
        d: '食べる',
        r: 'タベサセラレタ',
        b: 0,
        e: 7,
        p: '動詞',
        inflection: { labels: ['past', 'potential / passive', 'causative'], base: '食べる' },
      },
    ]);

    expect(stacked?.inflectionLabels).toEqual(['past', 'potential / passive', 'causative']);
  });

  it('leaves an uninflected token with no chain', () => {
    expect(enrichTokens(YAKETA)[1]?.inflectionLabels).toEqual([]);
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

  it('does not double the separator space after a gap in the content', () => {
    // Existing content whitespace already delimits kana; adding another separator would double the gap in
    // Anki.
    const acrossAGap: SlimToken[] = [
      { s: 'あ', d: 'あ', r: 'ア', b: 0, e: 1, p: '感動詞' },
      { s: '本', d: '本', r: 'ホン', b: 2, e: 3, p: '名詞', f: [{ t: '本', r: 'ほん' }] },
    ];

    expect(tokensToAnkiFurigana('あ 本', acrossAGap)).toBe('あ 本[ほん]');
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

  // Elasticsearch can match inside a Shirabe token; expose only the matched token-local range.
  it('reports a match that lands inside a token, with the part that matched', () => {
    const enriched = enrichTokens(YAKETA, '<em>焼け</em>たフライパンに');

    expect(enriched[0]?.matchType).toBe('partial');
    expect(enriched[0]?.highlightRanges).toEqual([{ start: 0, end: 2 }]);
  });
});

/**
 * Identify requires short POS tags for grammatical homograph disambiguation; unknown tags can silently lose
 * that ranking signal.
 */
describe('shortPos', () => {
  const token = (p: string, pt?: string): SlimToken =>
    ({ s: 'x', d: 'x', r: 'x', b: 0, e: 1, p, ...(pt ? { pt } : {}) }) as SlimToken;

  it('maps the UniDic categories onto Shirabe short tags', () => {
    expect(shortPos(token('動詞'))).toBe('verb');
    expect(shortPos(token('名詞'))).toBe('noun');
    expect(shortPos(token('助詞'))).toBe('prt');
    expect(shortPos(token('代名詞'))).toBe('pron');
  });

  it('folds both adjective categories together', () => {
    expect(shortPos(token('形容詞'))).toBe('adj');
    expect(shortPos(token('形状詞'))).toBe('adj');
  });

  // Merged expressions use exp even though they have no single morpheme POS.
  it('answers exp for a merged expression', () => {
    expect(shortPos(token('連語'))).toBe('exp');
  });

  // Nothing identify could rank. `isAskable` filters these out before a lookup,
  // so the empty string is belt and braces rather than a live path.
  it('answers nothing for punctuation, symbols and whitespace', () => {
    expect(shortPos(token('補助記号'))).toBe('');
    expect(shortPos(token('記号'))).toBe('');
    expect(shortPos(token('空白'))).toBe('');
  });

  it('does not pass an unknown category through', () => {
    expect(shortPos(token('感嘆詞'))).toBe('');
  });

  // Prefer the parser's stored tag over the copied fallback table.
  it('prefers the tag the token carries over the derivation', () => {
    expect(shortPos(token('名詞', 'pron'))).toBe('pron');
  });
});
