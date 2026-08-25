import type { SitemapUrlInput } from '#sitemap/types';
import { getSitemapLocale, localizeSitemapPath, wordSitemapPath } from './utils';

export default defineSitemapEventHandler(async (event) => {
  const sdk = useServerSdk(event);
  const urls: SitemapUrlInput[] = [];
  const locale = getSitemapLocale(event);

  // TIER 10000, DOWN FROM 20000 on 2026-08-25, and the halving is the point.
  // Word searches were 19,784 of the 24,766 URLs in the live sitemap -- 80% of
  // everything the site submitted -- and returned 80 clicks over the previous 3
  // months: 0.0040 clicks per submitted URL, against 0.0344 for a media title
  // and 0.0125 for an episode. They were the least productive template on the
  // site occupying four fifths of the invitation, while 4,644 episode URLs
  // submitted two days earlier had 49 of them crawled.
  //
  // The lower tier keeps the more frequently searched half. It does cost some of
  // the tail -- those 80 clicks are spread thin rather than concentrated, with
  // the top 5 URLs holding only 11 of them -- and that is the trade being made
  // deliberately: a diffuse 40-odd clicks back, for crawl budget moved to
  // templates earning ten times the rate per URL. Raise it again if the media
  // and sentence sources stop being the constraint.
  for await (const entry of sdk.getCoveredWords.paginate({ tier: 10000, filter: 'COVERED', take: 1000 })) {
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
