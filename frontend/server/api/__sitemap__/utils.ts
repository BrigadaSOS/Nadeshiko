import type { H3Event } from 'h3';
import { INDEXED_LOCALES, type IndexedLocale } from '~/utils/i18n';

export type SitemapLocale = IndexedLocale;

export function getSitemapLocale(event: H3Event): SitemapLocale {
  const locale = getQuery(event).locale;
  return typeof locale === 'string' && (INDEXED_LOCALES as readonly string[]).includes(locale)
    ? (locale as SitemapLocale)
    : 'en';
}

export function localizeSitemapPath(path: string, locale: SitemapLocale): string {
  return path === '/' ? `/${locale}` : `/${locale}${path}`;
}

// encodeURI leaves these URL-structural characters unescaped; such words cannot safely become raw path segments.
const URL_STRUCTURAL_CHARS = /[/?#&%]/;

// Return the raw word: @nuxtjs/sitemap applies encodeURI, so pre-encoding would escape percent signs twice.
export function wordSitemapPath(word: string): string | null {
  if (!word || URL_STRUCTURAL_CHARS.test(word)) return null;
  return `/search/${word}`;
}
