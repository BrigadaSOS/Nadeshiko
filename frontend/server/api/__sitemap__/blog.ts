import type { SitemapUrlInput } from '#sitemap/types';

export default defineSitemapEventHandler(async () => {
  const posts = await getBlogPosts('en');

  return posts.map(
    (post) =>
      ({
        loc: post.path,
        lastmod: post.date ?? undefined,
        changefreq: 'monthly',
      }) satisfies SitemapUrlInput,
  );
});
