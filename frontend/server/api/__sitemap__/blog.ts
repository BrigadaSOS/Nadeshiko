import type { SitemapUrlInput } from '#sitemap/types';

export default defineSitemapEventHandler(async () => {
  const [enPosts, esPosts] = await Promise.all([getBlogPosts('en'), getBlogPosts('es')]);

  const urls: SitemapUrlInput[] = [];

  for (const post of enPosts) {
    urls.push({ loc: post.path, lastmod: post.date ?? undefined, changefreq: 'monthly', _i18nTransform: false });
  }

  for (const post of esPosts) {
    urls.push({
      loc: `/es${post.path}`,
      lastmod: post.date ?? undefined,
      changefreq: 'monthly',
      _i18nTransform: false,
    });
  }

  return urls;
});
