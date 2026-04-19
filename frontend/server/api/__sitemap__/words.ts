import type { SitemapUrlInput } from '#sitemap/types';

export default defineSitemapEventHandler(async () => {
  const sdk = useServerSdk();
  const urls: SitemapUrlInput[] = [];

  for await (const entry of sdk.getCoveredWords.paginate({ tier: 50000, filter: 'COVERED', take: 1000 })) {
    urls.push({
      loc: `/search/${encodeURIComponent(entry.word)}`,
      changefreq: 'monthly',
    });
  }

  return urls;
});
