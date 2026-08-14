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
      changefreq: 'weekly',
    });
  }

  return urls;
});
