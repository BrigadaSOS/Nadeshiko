import { describe, expect, it } from 'vitest';
import { stableCacheKey } from './cacheKey';

describe('stableCacheKey', () => {
  it('is made only of characters Nitro keeps when escaping keys', () => {
    expect(stableCacheKey('兄', 'en')).toMatch(/^\w+$/);
  });

  it('keeps apart inputs that differ only in punctuation or non-ASCII text', () => {
    expect(stableCacheKey('k-on')).not.toBe(stableCacheKey('kon'));
    expect(stableCacheKey('兄')).not.toBe(stableCacheKey('姉'));
    expect(stableCacheKey('a', 'b')).not.toBe(stableCacheKey('a|b'));
  });

  it('is stable for the same input', () => {
    expect(stableCacheKey('兄', 'en')).toBe(stableCacheKey('兄', 'en'));
  });
});
