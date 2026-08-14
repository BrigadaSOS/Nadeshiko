import type { H3Event } from 'h3';

export type SitemapLocale = 'en' | 'es';

export function getSitemapLocale(event: H3Event): SitemapLocale {
  const locale = getQuery(event).locale;
  return locale === 'es' ? 'es' : 'en';
}

export function localizeSitemapPath(path: string, locale: SitemapLocale): string {
  return path === '/' ? `/${locale}` : `/${locale}${path}`;
}

/**
 * Characters that would change the SHAPE of a URL rather than sit inside a path
 * segment, and which `encodeURI` deliberately leaves alone.
 *
 * A word containing one of these cannot be expressed as a raw path segment (see
 * `wordSitemapPath`), and there is no way to escape it either, so such a word is
 * skipped rather than submitted as a URL that means something else.
 */
const URL_STRUCTURAL_CHARS = /[/?#&%]/;

/**
 * `/search/<word>` for the sitemap, with the word NOT pre-encoded.
 *
 * `@nuxtjs/sitemap` runs `encodeURI()` over every `loc` it writes
 * (`runtime/server/sitemap/urlset/normalise.js`). Encoding here as well is
 * therefore encoding twice, and the second pass escapes the percent signs left
 * by the first:
 *
 *     encodeURIComponent('だ')  ->  %E3%81%A0
 *     encodeURI('%E3%81%A0')    ->  %25E3%2581%25A0
 *
 * Which is a different URL. `/search/%25E3%2581%25A0` is a search for the
 * literal eleven-character text `%E3%81%A0`, and it renders -- at HTTP 200 -- a
 * no-results page titled `%E3%81%A0`. Every one of the ~19.8k word URLs in the
 * live sitemap was in that state, so the entire word corpus was being submitted
 * to search engines as near-identical empty pages.
 *
 * Returning the raw word lets the module's own `encodeURI` do the single pass
 * that was always intended.
 */
export function wordSitemapPath(word: string): string | null {
  if (!word || URL_STRUCTURAL_CHARS.test(word)) return null;
  return `/search/${word}`;
}
