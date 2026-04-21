import type { SitemapUrlInput } from '#sitemap/types';
import { getSitemapLocale, localizeSitemapPath } from './utils';

export default defineSitemapEventHandler(async (event) => {
  const sdk = useServerSdk();
  const urls: SitemapUrlInput[] = [];
  const locale = getSitemapLocale(event);

  for await (const media of sdk.listMedia.paginate({ take: 40 })) {
    urls.push({
      loc: localizeSitemapPath(`/search?media=${media.publicId}`, locale),
      changefreq: 'weekly',
    });
  }

  return urls;
});
