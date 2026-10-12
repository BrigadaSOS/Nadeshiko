import type { SitemapUrlInput } from '#sitemap/types';
import { getSitemapLocale, localizeSitemapPath, wordSitemapPath } from './utils';

export default defineSitemapEventHandler(async (event) => {
  const sdk = useServerSdk(event);
  const urls: SitemapUrlInput[] = [];
  const locale = getSitemapLocale(event);

  // Limit less productive word-search discovery to leave crawl budget for media and sentence pages.
  for await (const entry of sdk.getCoveredWords.paginate({ tier: 10000, filter: 'COVERED', take: 1000 })) {
    const path = wordSitemapPath(entry.word);
    if (!path) continue;

    urls.push({
      loc: localizeSitemapPath(path, locale),
      changefreq: 'monthly',
    });
  }

  return urls;
});
