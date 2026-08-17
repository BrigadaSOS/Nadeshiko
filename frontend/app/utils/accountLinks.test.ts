import { describe, expect, it } from 'vitest';
import { isAccountLinkCallback } from './accountLinks';

// The auth-callback plugin reacts to any page carrying `code`/`state`, so this
// predicate is the whole of what keeps a third-party link from being mistaken
// for a sign-in. A miss here is not an error anybody sees: it is a bogus
// "signed in" toast, a fabricated login event, and a stripped query.
describe('isAccountLinkCallback', () => {
  it('recognises the link callback, with and without a locale prefix', () => {
    expect(isAccountLinkCallback('/link/shirabe/callback')).toBe(true);
    expect(isAccountLinkCallback('/en/link/shirabe/callback')).toBe(true);
    expect(isAccountLinkCallback('/es/link/shirabe/callback')).toBe(true);
    expect(isAccountLinkCallback('/ja/link/shirabe/callback')).toBe(true);
  });

  it('leaves a real auth callback alone', () => {
    expect(isAccountLinkCallback('/')).toBe(false);
    expect(isAccountLinkCallback('/en')).toBe(false);
    expect(isAccountLinkCallback('/en/user/settings')).toBe(false);
  });

  // Anchored on purpose: a page whose path merely CONTAINS the segment is not
  // the callback, and an unanchored test would hand it the same exemption.
  it('does not match a path that merely contains the segment', () => {
    expect(isAccountLinkCallback('/en/blog/link/shirabe')).toBe(false);
    expect(isAccountLinkCallback('/linked')).toBe(false);
    expect(isAccountLinkCallback('/en/linkage/x')).toBe(false);
  });
});
