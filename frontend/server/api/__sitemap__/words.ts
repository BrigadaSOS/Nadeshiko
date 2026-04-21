import type { SitemapUrlInput } from '#sitemap/types';
import { getSitemapLocale, localizeSitemapPath } from './utils';

export default defineSitemapEventHandler(async (event) => {
  const sdk = useServerSdk();
  const urls: SitemapUrlInput[] = [];
  const locale = getSitemapLocale(event);

  for await (const entry of sdk.getCoveredWords.paginate({ tier: 50000, filter: 'COVERED', take: 1000 })) {
    urls.push({
      loc: localizeSitemapPath(`/search/${encodeURIComponent(entry.word)}`, locale),
      changefreq: 'monthly',
    });
  }

  return urls;
});
