import type { SitemapUrlInput } from '#sitemap/types';

export default defineSitemapEventHandler(async () => {
  const sdk = useServerSdk();
  const urls: SitemapUrlInput[] = [];

  for await (const media of sdk.listMedia.paginate({ take: 40 })) {
    urls.push({
      loc: `/search?media=${media.mediaPublicId}`,
      changefreq: 'weekly',
    });
  }

  return urls;
});
