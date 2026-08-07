import { describe, expect, it } from 'vitest';
import {
  RESERVED_EXACT,
  RESERVED_PREFIXES,
  getLocalePrefix,
  isReservedLocalePath,
  resolveRootLocale,
} from './localeRouting';

describe('isReservedLocalePath', () => {
  it('keeps Nuxt internal error rendering outside locale redirects', () => {
    expect(isReservedLocalePath('/__nuxt_error')).toBe(true);
  });

  it('does not reserve user-facing content paths', () => {
    expect(isReservedLocalePath('/about')).toBe(false);
    expect(isReservedLocalePath('/blog/example')).toBe(false);
  });
});

// The HTML rate limiter (server/middleware/99-rate-limit-html.ts) skips exactly
// these two sets, so they have to keep covering the app's own plumbing: the API
// proxy, Nuxt's assets and the health endpoint must never be throttled as if a
// reader had asked for a page.
describe('reserved path sets', () => {
  it('covers the API proxy and internal asset routes', () => {
    for (const prefix of ['/v1/', '/api/', '/_nuxt/', '/_i18n/', '/media/']) {
      expect(RESERVED_PREFIXES).toContain(prefix);
    }
  });

  it('covers the health endpoint and crawler files exactly', () => {
    for (const path of ['/up', '/robots.txt', '/opensearch.xml', '/favicon.ico']) {
      expect(RESERVED_EXACT.has(path)).toBe(true);
    }
  });

  it('does not reserve the pages readers actually request', () => {
    for (const path of ['/', '/media', '/blog', '/search', '/user/settings']) {
      expect(RESERVED_EXACT.has(path)).toBe(false);
      expect(RESERVED_PREFIXES.some((prefix) => path.startsWith(prefix))).toBe(false);
    }
  });
});

describe('getLocalePrefix', () => {
  it('recognises a locale that is the whole path, and one that starts it', () => {
    expect(getLocalePrefix('/es')).toBe('es');
    expect(getLocalePrefix('/es/search/hello')).toBe('es');
    expect(getLocalePrefix('/ja')).toBe('ja');
  });

  it('does not treat a longer word starting with a locale code as prefixed', () => {
    expect(getLocalePrefix('/english')).toBeNull();
    expect(getLocalePrefix('/estimates')).toBeNull();
  });

  it('reports the bare root and unprefixed deep links as unprefixed', () => {
    expect(getLocalePrefix('/')).toBeNull();
    expect(getLocalePrefix('/about')).toBeNull();
  });
});

// `resolveRootLocale` is the origin half of a decision Cloudflare answers at the
// edge for most visitors. Both sides read the same single input -- the plain
// `nd-locale-preference` cookie -- so they cannot disagree about where `/` goes.
// These cases are the ones the Redirect Rules mirror; if a change here makes any
// of them fail, the edge rules have to change in the same commit.
describe('resolveRootLocale', () => {
  it('sends a reader with no cookie to English', () => {
    expect(resolveRootLocale(undefined)).toBe('en');
    expect(resolveRootLocale(null)).toBe('en');
    expect(resolveRootLocale('')).toBe('en');
  });

  it('honours every locale the language selector can write', () => {
    expect(resolveRootLocale('en')).toBe('en');
    expect(resolveRootLocale('es')).toBe('es');
    expect(resolveRootLocale('ja')).toBe('ja');
  });

  it('falls back to English rather than trusting a cookie a visitor forged', () => {
    expect(resolveRootLocale('de')).toBe('en');
    expect(resolveRootLocale('es-ES')).toBe('en');
    expect(resolveRootLocale('../../etc/passwd')).toBe('en');
  });

  // The signature is the contract. Cloudflare Redirect Rules can read a plain
  // cookie and nothing else -- no q-value weighing, no geo, no session lookup --
  // so a second parameter here is the point at which the redirect stops being
  // answerable at the edge and every cold visit pays the round trip again.
  it('takes exactly one argument, so nothing the edge cannot read creeps in', () => {
    expect(resolveRootLocale.length).toBe(1);
  });
});
