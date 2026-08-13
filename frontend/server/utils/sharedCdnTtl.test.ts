import { describe, it, expect } from 'vitest';
import {
  SHARED_CDN_MAX_AGE_DEFAULT,
  SHARED_CDN_MAX_AGE_SEARCH,
  SHARED_CDN_MAX_AGE_SENTENCE,
  sharedCdnMaxAge,
} from '~~/server/utils/sharedCdnTtl';

/**
 * The TTL is the difference between a moderator's correction appearing in five
 * minutes or in an hour, and it is chosen from the path alone. Nothing else
 * checks it: a locale prefix this function fails to strip silently downgrades
 * that page to the short default, which looks like nothing at all.
 */
describe('sharedCdnMaxAge', () => {
  it.each(['en', 'es', 'ja'])('gives sentence permalinks the long TTL under /%s', (locale) => {
    expect(sharedCdnMaxAge(`/${locale}/sentence/wy1hTtMJg6Jf`)).toBe(SHARED_CDN_MAX_AGE_SENTENCE);
  });

  it.each(['en', 'es', 'ja'])('gives search the long TTL under /%s', (locale) => {
    expect(sharedCdnMaxAge(`/${locale}/search/%E7%8C%AB`)).toBe(SHARED_CDN_MAX_AGE_SEARCH);
  });

  it('covers the bare search page as well as a query', () => {
    expect(sharedCdnMaxAge('/en/search')).toBe(SHARED_CDN_MAX_AGE_SEARCH);
  });

  // These carry "recently added" surfaces, and `/api/home/recent-media` behind
  // them is only `swr: 300` -- an hour of HTML would promise a freshness the
  // data does not have.
  it.each(['/en', '/ja', '/en/media', '/en/media/abc123'])('leaves %s on the short default', (path) => {
    expect(sharedCdnMaxAge(path)).toBe(SHARED_CDN_MAX_AGE_DEFAULT);
  });

  // Segment-aware for the same reason `isPrivatePath` is: a plain prefix match
  // would read these as locale-prefixed and mangle the remaining path.
  it.each(['/english/sentence/x', '/entries/search/x', '/japan/search'])(
    'does not mistake %s for a locale prefix',
    (path) => {
      expect(sharedCdnMaxAge(path)).toBe(SHARED_CDN_MAX_AGE_DEFAULT);
    },
  );

  it('does not match a path that merely contains the word', () => {
    expect(sharedCdnMaxAge('/en/user/sentence-history')).toBe(SHARED_CDN_MAX_AGE_DEFAULT);
    expect(sharedCdnMaxAge('/en/searchable-guide')).toBe(SHARED_CDN_MAX_AGE_DEFAULT);
  });
});
