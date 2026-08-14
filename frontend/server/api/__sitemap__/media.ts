import type { SitemapUrlInput } from '#sitemap/types';
import { buildMediaPath } from '~/utils/routes';
import { getSitemapLocale, localizeSitemapPath } from './utils';

export default defineSitemapEventHandler(async (event) => {
  const sdk = useServerSdk(event);
  const urls: SitemapUrlInput[] = [];
  const locale = getSitemapLocale(event);

  for await (const media of sdk.listMedia.paginate({ take: 40 })) {
    // `/media/<slug>`, not `/search?media=<publicId>`. The old form submitted 317
    // URLs whose only distinguishing part was an opaque twelve-character id in a
    // filter parameter -- nothing in them said which work the page was about.
    // The search page 301s the old form here, so both stay reachable.
    if (!media.slug) continue;
    urls.push({
      loc: localizeSitemapPath(buildMediaPath(media.slug), locale),
      // The record's real modification time, and omitted rather than invented
      // when the row has never been updated. `lastmod` is the one hint here that
      // search engines still act on, and an inaccurate one -- a build timestamp,
      // say -- gets it discounted for the whole site, so a missing value is
      // strictly better than a plausible guess.
      //
      // `changefreq` stays only because it costs nothing; Google ignores it.
      ...(media.updatedAt ? { lastmod: media.updatedAt } : {}),
      changefreq: 'weekly',
    });
  }

  return urls;
});
