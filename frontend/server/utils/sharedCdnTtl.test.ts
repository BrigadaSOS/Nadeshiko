import { describe, it, expect } from 'vitest';
import {
  SHARED_CDN_MAX_AGE_DEFAULT,
  SHARED_CDN_MAX_AGE_NON_PROD,
  SHARED_CDN_MAX_AGE_SEARCH,
  SHARED_CDN_MAX_AGE_SENTENCE,
  sharedCdnMaxAge,
} from '~~/server/utils/sharedCdnTtl';

/** Every path case is about production, where the per-path TTLs apply. */
const prod = (path: string) => sharedCdnMaxAge(path, 'production');

/**
 * The TTL is the difference between a moderator's correction appearing in five
 * minutes or in an hour, and it is chosen from the path alone. Nothing else
 * checks it: a locale prefix this function fails to strip silently downgrades
 * that page to the short default, which looks like nothing at all.
 */
describe('sharedCdnMaxAge', () => {
  it.each(['en', 'es', 'ja'])('gives sentence permalinks the long TTL under /%s', (locale) => {
    expect(prod(`/${locale}/sentence/wy1hTtMJg6Jf`)).toBe(SHARED_CDN_MAX_AGE_SENTENCE);
  });

  it.each(['en', 'es', 'ja'])('gives search the long TTL under /%s', (locale) => {
    expect(prod(`/${locale}/search/%E7%8C%AB`)).toBe(SHARED_CDN_MAX_AGE_SEARCH);
  });

  it('covers the bare search page as well as a query', () => {
    expect(prod('/en/search')).toBe(SHARED_CDN_MAX_AGE_SEARCH);
  });

  // These carry "recently added" surfaces, and `/api/home/recent-media` behind
  // them is only `swr: 300` -- an hour of HTML would promise a freshness the
  // data does not have.
  it.each(['/en', '/ja', '/en/media', '/en/media/abc123'])('leaves %s on the short default', (path) => {
    expect(prod(path)).toBe(SHARED_CDN_MAX_AGE_DEFAULT);
  });

  // Segment-aware for the same reason `isPrivatePath` is: a plain prefix match
  // would read these as locale-prefixed and mangle the remaining path.
  it.each(['/english/sentence/x', '/entries/search/x', '/japan/search'])(
    'does not mistake %s for a locale prefix',
    (path) => {
      expect(prod(path)).toBe(SHARED_CDN_MAX_AGE_DEFAULT);
    },
  );

  it('does not match a path that merely contains the word', () => {
    expect(prod('/en/user/sentence-history')).toBe(SHARED_CDN_MAX_AGE_DEFAULT);
    expect(prod('/en/searchable-guide')).toBe(SHARED_CDN_MAX_AGE_DEFAULT);
  });

  /**
   * Staging deploys and then immediately asks the edge whether the deploy
   * worked. At an hour, `/search/*` answered for the build before -- which is
   * how two green fixes came back as E2E failures on the release that carried
   * them.
   */
  describe('outside production', () => {
    it.each(['development', 'local', undefined])('caps every path at ten seconds under %s', (environment) => {
      expect(sharedCdnMaxAge('/en/search/%E7%8C%AB', environment)).toBe(SHARED_CDN_MAX_AGE_NON_PROD);
      expect(sharedCdnMaxAge('/en/sentence/wy1hTtMJg6Jf', environment)).toBe(SHARED_CDN_MAX_AGE_NON_PROD);
      expect(sharedCdnMaxAge('/en', environment)).toBe(SHARED_CDN_MAX_AGE_NON_PROD);
    });

    // A cap, not a replacement: a path already shorter than the ceiling keeps
    // its own TTL rather than being lengthened to meet it.
    it('never lengthens a path that is already shorter', () => {
      expect(SHARED_CDN_MAX_AGE_NON_PROD).toBeLessThan(SHARED_CDN_MAX_AGE_DEFAULT);
    });

    // The header still goes out, so the anonymous-only / 200-only gating around
    // it stays exercised everywhere rather than only in production.
    it('stays a positive TTL rather than disabling the header', () => {
      expect(sharedCdnMaxAge('/en/search', 'development')).toBeGreaterThan(0);
    });
  });
});
