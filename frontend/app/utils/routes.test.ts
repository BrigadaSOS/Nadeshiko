import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from './i18n';
import {
  SEARCH_QUERY_MAX_LENGTH,
  canonicalPath,
  decodeSearchQuery,
  isJunkSearchQuery,
  splitLocalePrefix,
  withLocalePrefix,
} from './routes';

describe('splitLocalePrefix', () => {
  // The prefixes are derived from SUPPORTED_LOCALES rather than hand-listed, so
  // a locale added there can never go unrecognised here.
  it.each(SUPPORTED_LOCALES)('recognises the /%s prefix', (locale) => {
    expect(splitLocalePrefix(`/${locale}/search/foo`)).toEqual({
      localePrefix: `/${locale}`,
      localizedPath: '/search/foo',
    });
  });

  it('treats a bare locale root as that locale', () => {
    expect(splitLocalePrefix('/en')).toEqual({ localePrefix: '/en', localizedPath: '/' });
  });

  it('leaves unprefixed paths alone', () => {
    expect(splitLocalePrefix('/blog/example')).toEqual({ localePrefix: '', localizedPath: '/blog/example' });
  });

  // /english is not the /en locale.
  it('only matches whole prefix segments', () => {
    expect(splitLocalePrefix('/english')).toEqual({ localePrefix: '', localizedPath: '/english' });
  });
});

describe('withLocalePrefix', () => {
  it('round-trips a split path', () => {
    const { localePrefix, localizedPath } = splitLocalePrefix('/es/media');
    expect(withLocalePrefix(localePrefix, localizedPath)).toBe('/es/media');
  });

  it('keeps the locale root free of a trailing slash', () => {
    expect(withLocalePrefix('/ja', '/')).toBe('/ja');
  });

  it('is a no-op without a prefix', () => {
    expect(withLocalePrefix('', '/media')).toBe('/media');
  });
});

describe('decodeSearchQuery', () => {
  it('decodes the raw param exactly once', () => {
    // The router does not decode this param, so `%2541` is text meaning `%41`,
    // not text meaning `A`. Decoding twice was how the page read its own query.
    expect(decodeSearchQuery('%E8%AD%B2')).toBe('譲');
    expect(decodeSearchQuery('%2541')).toBe('%41');
  });

  // Each of these threw a URIError straight out of page setup, which Nuxt
  // answered with `{"statusCode":500,"message":"URI malformed"}`.
  it.each(['%E8%AD', '%C0%80', '%25E8%AD%B2', '%'])('survives the malformed escape %s', (raw) => {
    expect(() => decodeSearchQuery(raw)).not.toThrow();
    expect(decodeSearchQuery(raw)).toBe(raw);
  });
});

describe('isJunkSearchQuery', () => {
  it('keeps queries a reader could have typed', () => {
    expect(isJunkSearchQuery('%E8%AD%B2')).toBe(false);
    expect(isJunkSearchQuery('%E5%BD%BC%E5%A5%B3')).toBe(false);
    // A literal percent survives: `100%` is a search, not a broken escape.
    expect(isJunkSearchQuery('100%25')).toBe(false);
  });

  it('rejects a query that does not decode', () => {
    expect(isJunkSearchQuery('%E8%AD')).toBe(true);
    expect(isJunkSearchQuery('%C0%80')).toBe(true);
  });

  it('rejects a URL fed in as a search term', () => {
    // The shape the canonical loop minted, shortened.
    expect(isJunkSearchQuery('%2Fen%2Fsearch%2F%2525E8')).toBe(true);
  });

  it('rejects a query the backend would reject anyway', () => {
    expect(isJunkSearchQuery('あ'.repeat(SEARCH_QUERY_MAX_LENGTH))).toBe(false);
    expect(isJunkSearchQuery('あ'.repeat(SEARCH_QUERY_MAX_LENGTH + 1))).toBe(true);
  });
});

describe('canonicalPath', () => {
  it('leaves routes without a search query alone', () => {
    expect(canonicalPath('/en/sentence/gFH5xlsT--zr', undefined)).toBe('/en/sentence/gFH5xlsT--zr');
    expect(canonicalPath('/es/search', undefined)).toBe('/es/search');
  });

  it('undoes the extra layer the router adds to route.path', () => {
    // Requested /en/search/%25E8; `route.path` reads it back one layer deeper.
    expect(canonicalPath('/en/search/%2525E8', '%25E8')).toBe('/en/search/%25E8');
  });

  // The property that actually stops the loop: feed the output back in as the
  // next request and nothing new is minted. Before this, each pass added a
  // layer and prod grew 12 bytes a hop with no ceiling.
  it.each(['%E8%AD%B2', '%25E8', '100%25', 'Tiny'])('is a fixed point for %s', (raw) => {
    const first = canonicalPath(`/en/search/${encodeURIComponent(raw)}`, raw);
    const nextRawParam = first.slice('/en/search/'.length);
    expect(canonicalPath(`/en/search/${encodeURIComponent(nextRawParam)}`, nextRawParam)).toBe(first);
  });

  it('keeps the locale it was asked about', () => {
    expect(canonicalPath('/ja/search/%2525E8', '%25E8')).toBe('/ja/search/%25E8');
  });
});
