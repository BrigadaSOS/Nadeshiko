import type { SitemapUrlInput } from '#sitemap/types';
import { getSitemapLocale, localizeSitemapPath, wordSitemapPath } from './utils';

export default defineSitemapEventHandler(async (event) => {
  const sdk = useServerSdk(event);
  const urls: SitemapUrlInput[] = [];
  const locale = getSitemapLocale(event);

  for await (const entry of sdk.getCoveredWords.paginate({ tier: 20000, filter: 'COVERED', take: 1000 })) {
    // Raw, NOT `encodeURIComponent`. The module encodes every `loc` itself, and
    // doing it here as well produced `%25E3%2581%25A0` for `だ` -- see
    // `wordSitemapPath`, which is where that whole story is written down.
    const path = wordSitemapPath(entry.word);
    if (!path) continue;

    urls.push({
      loc: localizeSitemapPath(path, locale),
      changefreq: 'monthly',
    });
  }

  return urls;
});
