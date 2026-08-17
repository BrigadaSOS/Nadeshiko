import { describe, expect, it } from 'vitest';
import { __testing } from '~/utils/wordLookup';

const { cacheKey } = __testing;

describe('cacheKey', () => {
  // The reason the whole tuple is the key rather than the lemma. 開く is あく or
  // ひらく depending on how the sentence read it, and they are different words:
  // one answer must never be served for the other.
  it('separates homographs that share a lemma', () => {
    const aku = cacheKey({ lemma: '開く', surface: '開く', reading: 'アク', pos: 'verb' }, 'en', '');
    const hiraku = cacheKey({ lemma: '開く', surface: '開いた', reading: 'ヒライタ', pos: 'verb' }, 'en', '');

    expect(aku).not.toBe(hiraku);
  });

  it('treats two tokens for the same word in the same shape as one question', () => {
    const ref = { lemma: '食べる', surface: '食べました', reading: 'タベマシタ', pos: 'verb' };

    expect(cacheKey(ref, 'en', '')).toBe(cacheKey({ ...ref }, 'en', ''));
  });

  // Locale changes the part-of-speech labels, so it cannot collapse into the
  // word's identity.
  it('keeps the locales apart', () => {
    const ref = { lemma: '本', surface: '本', reading: 'ホン', pos: 'noun' };

    expect(cacheKey(ref, 'en', '')).not.toBe(cacheKey(ref, 'es', ''));
  });

  // A token can arrive with no reading or POS at all, and those must not collide
  // with a token that genuinely carries a different one.
  it('does not let an empty field impersonate a present one', () => {
    const bare = cacheKey({ lemma: '開く', surface: '開く', reading: '', pos: 'verb' }, 'en', '');
    const read = cacheKey({ lemma: '開く', surface: '開く', reading: 'アク', pos: 'verb' }, 'en', '');

    expect(bare).not.toBe(read);
  });

  // Fields are delimited, so a value cannot slide across a boundary and make two
  // different words hash the same.
  it('cannot be confused by a field boundary', () => {
    const a = cacheKey({ lemma: 'a', surface: 'b', reading: '', pos: '' }, 'en', '');
    const b = cacheKey({ lemma: 'ab', surface: '', reading: '', pos: '' }, 'en', '');

    expect(a).not.toBe(b);
  });

  // The reason a linked reader's stack is in the key at all. Shirabe answers a
  // lookup from the dictionaries the reader configured over there, so the same
  // token really is a different question once they change them -- and the answer
  // is cached in this browser for a day.
  it('separates the same word under two dictionary stacks', () => {
    const ref = { lemma: '猫', surface: '猫', reading: 'ネコ', pos: 'noun' };

    expect(cacheKey(ref, 'en', 'abc123')).not.toBe(cacheKey(ref, 'en', 'def456'));
    expect(cacheKey(ref, 'en', '')).not.toBe(cacheKey(ref, 'en', 'abc123'));
  });
});
