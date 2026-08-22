import type { SitemapUrlInput } from '#sitemap/types';
import { buildMediaPath } from '~/utils/routes';
import { getSitemapLocale, localizeSitemapPath } from './utils';

/**
 * `/media/<slug>?episode=<n>`, the crawl path to the corpus itself.
 *
 * WHAT THIS FIXES. The sitemap submitted 320 media pages, 19,784 word searches
 * and eight static URLs -- and not one of the 1.3M sentence permalinks, which
 * are the pages people actually share. They were reachable only by crawling
 * search results, the single most expensive thing this site can serve.
 *
 * NOT THE SENTENCES THEMSELVES, deliberately. Submitting 1.3M URLs would mean
 * paginating the whole corpus through the API on every sitemap build, and would
 * spend the crawl budget on the thinnest pages here. An episode page carries 30
 * sentence permalinks and links deeper, so a few thousand of these open the
 * corpus at a cost proportional to the catalogue rather than to the corpus.
 *
 * READ FROM `listEpisodes`, NOT COUNTED FROM `episodeCount`. Episode numbers
 * are not always 1..n: the schema says 0 for movies and specials, and a title
 * in the local corpus runs 0..12 with `episodeCount` 13. Counting would have
 * skipped its episode 0 and invented an episode 13, which renders an empty
 * page at HTTP 200 -- exactly the kind of URL the rest of this change is
 * removing from the index.
 *
 * SINGLE-EPISODE TITLES ARE SKIPPED. `?episode=1` on a film is the same page as
 * `/media/<slug>`, which the media source already submits.
 *
 * The per-media calls run in small batches: 320 sequential round trips does not
 * fit the source's timeout, and 320 concurrent ones is a burst at the origin
 * for a file rebuilt once a day.
 */
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
        } catch {
          // One unreachable title costs its own episodes, not the sitemap. A
          // source that throws here returns nothing at all, and a sitemap that
          // silently shrinks to zero is worse than one missing a show.
          return [];
        }
        return episodes.map((episodeNumber) => ({
          loc: localizeSitemapPath(buildMediaPath(title.slug, episodeNumber), locale),
          // The title's own modification time, as in the media source: omitted
          // rather than invented, because an inaccurate `lastmod` gets the hint
          // discounted for the whole site.
          ...(title.updatedAt ? { lastmod: title.updatedAt } : {}),
          changefreq: 'weekly' as const,
        }));
      }),
    );
    urls.push(...results.flat());
  }

  return urls;
});
