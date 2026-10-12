import type { SitemapUrlInput } from '#sitemap/types';
import { buildMediaPath } from '~/utils/routes';
import { getSitemapLocale, localizeSitemapPath } from './utils';

// Episode pages expose corpus permalinks at catalogue-sized cost. Read actual episode numbers: movies/specials
// may use 0. Skip single-episode duplicates and batch calls to fit the timeout without flooding the backend.
const EPISODE_FETCH_BATCH = 5;

export default defineSitemapEventHandler(async (event) => {
  const sdk = useServerSdk(event);
  const locale = getSitemapLocale(event);

  const titles: { slug: string; publicId: string; updatedAt?: string | null }[] = [];
  for await (const media of sdk.listMedia.paginate({ take: 40 })) {
    if (!media.slug || (media.episodeCount ?? 0) <= 1) continue;
    titles.push({ slug: media.slug, publicId: media.publicId, updatedAt: media.updatedAt });
  }

  const urls: SitemapUrlInput[] = [];

  for (let i = 0; i < titles.length; i += EPISODE_FETCH_BATCH) {
    const batch = titles.slice(i, i + EPISODE_FETCH_BATCH);
    const results = await Promise.all(
      batch.map(async (title) => {
        const episodes: number[] = [];
        try {
          for await (const episode of sdk.listEpisodes.paginate({ mediaPublicId: title.publicId, take: 100 })) {
            episodes.push(episode.episodeNumber);
          }
        } catch (error) {
          if (process.env.NADESHIKO_SITEMAP_GENERATOR === '1') throw error;
          // In reader-serving workers, one unreachable title must not empty the whole sitemap.
          return [];
        }
        return episodes.map((episodeNumber) => ({
          loc: localizeSitemapPath(buildMediaPath(title.slug, episodeNumber), locale),
          // Use real modification times only; invented lastmod values undermine the hint.
          ...(title.updatedAt ? { lastmod: title.updatedAt } : {}),
          changefreq: 'weekly' as const,
        }));
      }),
    );
    urls.push(...results.flat());
  }

  return urls;
});
