import type { SitemapUrlInput } from '#sitemap/types';
import { buildMediaPath } from '~/utils/routes';
import { getSitemapLocale, localizeSitemapPath } from './utils';

export default defineSitemapEventHandler(async (event) => {
  const sdk = useServerSdk(event);
  const urls: SitemapUrlInput[] = [];
  const locale = getSitemapLocale(event);

  for await (const media of sdk.listMedia.paginate({ take: 40 })) {
    if (!media.slug) continue;
    urls.push({
      loc: localizeSitemapPath(buildMediaPath(media.slug), locale),
      // Omit unknown lastmod rather than invent a timestamp search engines may discount.
      ...(media.updatedAt ? { lastmod: media.updatedAt } : {}),
      changefreq: 'weekly',
    });
  }

  return urls;
});
