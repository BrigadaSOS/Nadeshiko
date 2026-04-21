import type { H3Event } from 'h3';

export type SitemapLocale = 'en' | 'es';

export function getSitemapLocale(event: H3Event): SitemapLocale {
  const locale = getQuery(event).locale;
  return locale === 'es' ? 'es' : 'en';
}

export function localizeSitemapPath(path: string, locale: SitemapLocale): string {
  if (locale === 'en') {
    return path;
  }

  return path === '/' ? '/es' : `/es${path}`;
}
