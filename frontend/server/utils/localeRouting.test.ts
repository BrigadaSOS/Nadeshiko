import { describe, expect, it } from 'vitest';
import { RESERVED_EXACT, RESERVED_PREFIXES, isReservedLocalePath } from './localeRouting';

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
