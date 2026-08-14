import { describe, expect, it } from 'vitest';
import { localizeSitemapPath, wordSitemapPath } from './utils';

describe('wordSitemapPath', () => {
  /**
   * The regression this exists for. `@nuxtjs/sitemap` runs `encodeURI` over
   * every `loc`, so pre-encoding here escaped the percent signs a second time
   * and put ~19.8k URLs in the live sitemap that pointed at no-results pages.
   */
  it('leaves the word raw for the module to encode once', () => {
    expect(wordSitemapPath('だ')).toBe('/search/だ');
    expect(wordSitemapPath('食べる')).toBe('/search/食べる');
    // The shape that was being emitted, spelled out so it cannot come back.
    expect(wordSitemapPath('だ')).not.toContain('%');
  });

  it('applies the single encoding pass correctly end to end', () => {
    // What the module does to the value this returns.
    expect(encodeURI(localizeSitemapPath(wordSitemapPath('だ') ?? '', 'en'))).toBe('/en/search/%E3%81%A0');
  });

  // `encodeURI` leaves these alone, so a raw path segment containing one would
  // silently become a different URL -- a new path segment, a query, a fragment.
  it('skips words that would change the URL shape', () => {
    expect(wordSitemapPath('a/b')).toBeNull();
    expect(wordSitemapPath('a?b')).toBeNull();
    expect(wordSitemapPath('a#b')).toBeNull();
    expect(wordSitemapPath('a&b')).toBeNull();
    expect(wordSitemapPath('100%')).toBeNull();
  });

  it('skips an empty word', () => {
    expect(wordSitemapPath('')).toBeNull();
  });
});

describe('localizeSitemapPath', () => {
  it('prefixes the locale', () => {
    expect(localizeSitemapPath('/search/だ', 'en')).toBe('/en/search/だ');
    expect(localizeSitemapPath('/media/steins-gate', 'es')).toBe('/es/media/steins-gate');
  });

  it('collapses the root rather than emitting a trailing slash', () => {
    expect(localizeSitemapPath('/', 'en')).toBe('/en');
  });
});
