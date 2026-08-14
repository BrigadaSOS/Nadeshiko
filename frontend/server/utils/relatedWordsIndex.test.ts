import { describe, expect, it } from 'vitest';
import { extractKanji } from './relatedWordsIndex';

describe('extractKanji', () => {
  it('keeps only CJK ideographs', () => {
    expect(extractKanji('食べる')).toEqual(['食']);
    expect(extractKanji('食事')).toEqual(['食', '事']);
  });

  // A kana-only word relates to nothing by character, and the caller returns no
  // links at all rather than noisy ones.
  it('finds nothing in kana', () => {
    expect(extractKanji('きれい')).toEqual([]);
    expect(extractKanji('ある')).toEqual([]);
    expect(extractKanji('コーヒー')).toEqual([]);
  });

  // Duplicates would double-count a word's relevance to itself in the scoring.
  it('deduplicates repeated characters', () => {
    expect(extractKanji('人人')).toEqual(['人']);
  });

  it('ignores punctuation and latin text', () => {
    expect(extractKanji('日本語!')).toEqual(['日', '本', '語']);
    expect(extractKanji('OK')).toEqual([]);
  });
});
