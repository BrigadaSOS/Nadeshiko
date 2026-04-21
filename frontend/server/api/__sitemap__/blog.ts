import type { SitemapUrlInput } from '#sitemap/types';
import { getSitemapLocale, localizeSitemapPath } from './utils';

export default defineSitemapEventHandler(async (event) => {
  const locale = getSitemapLocale(event);
  const posts = await getBlogPosts(locale);

  const urls: SitemapUrlInput[] = [];

  for (const post of posts) {
    urls.push({
      loc: localizeSitemapPath(post.path, locale),
      lastmod: post.date ?? undefined,
      changefreq: 'monthly',
      _i18nTransform: false,
    });
  }

  return urls;
});
