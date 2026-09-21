import { describe, expect, it } from 'vitest';
import { __testing } from '~/utils/wordLookup';

const { positionedCacheKey } = __testing;

describe('positionedCacheKey', () => {
  it('separates spans in the same sentence', () => {
    const first = { text: '猫と猫', startOffset: 0, endOffset: 1 };
    const second = { text: '猫と猫', startOffset: 2, endOffset: 3 };

    expect(positionedCacheKey(first, 'en', '')).not.toBe(positionedCacheKey(second, 'en', ''));
  });

  it('separates the same span in different contexts', () => {
    const target = { text: '窓を開いた', startOffset: 2, endOffset: 5 };

    expect(positionedCacheKey(target, 'en', '')).not.toBe(
      positionedCacheKey({ ...target, text: '箱を開いた' }, 'en', ''),
    );
  });

  it('keeps label locales and reader dictionary stacks separate', () => {
    const target = { text: '猫', startOffset: 0, endOffset: 1 };

    expect(positionedCacheKey(target, 'en', '')).not.toBe(positionedCacheKey(target, 'es', ''));
    expect(positionedCacheKey(target, 'en', 'old')).not.toBe(positionedCacheKey(target, 'en', 'new'));
  });
});
