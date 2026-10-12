import type { SitemapUrlInput } from '#sitemap/types';
import { buildSentencePath } from '~/utils/routes';
import { getSitemapLocale, localizeSitemapPath } from './utils';

// Sample one actual episode per title instead of scanning the corpus. Episode numbers may start at 0.
// Submit only ACTIVE, SAFE/SUGGESTIVE segments: sitemap discovery is narrower than direct URL access.
const TITLE_FETCH_BATCH = 8;
const SEGMENTS_PER_TITLE = 30;
const SITEMAP_RATINGS = new Set(['SAFE', 'SUGGESTIVE']);

export default defineSitemapEventHandler(async (event) => {
  const sdk = useServerSdk(event);
  const locale = getSitemapLocale(event);

  const mediaIds: string[] = [];
  for await (const media of sdk.listMedia.paginate({ take: 40 })) {
    mediaIds.push(media.publicId);
  }

  const urls: SitemapUrlInput[] = [];

  for (let i = 0; i < mediaIds.length; i += TITLE_FETCH_BATCH) {
    const batch = mediaIds.slice(i, i + TITLE_FETCH_BATCH);
    const results = await Promise.all(
      batch.map(async (mediaPublicId) => {
        try {
          let episodeNumber: number | null = null;
          for await (const episode of sdk.listEpisodes.paginate({ mediaPublicId, take: 1 })) {
            episodeNumber = episode.episodeNumber;
            break;
          }
          if (episodeNumber === null) return [];

          const paths: string[] = [];
          for await (const segment of sdk.listSegments.paginate({
            mediaPublicId,
            episodeNumber,
            take: SEGMENTS_PER_TITLE,
          })) {
            if (segment.status !== 'ACTIVE') continue;
            if (!SITEMAP_RATINGS.has(segment.contentRating)) continue;
            if (!segment.publicId) continue;
            paths.push(buildSentencePath(segment.publicId));
            if (paths.length >= SEGMENTS_PER_TITLE) break;
          }
          return paths;
        } catch (error) {
          if (process.env.NADESHIKO_SITEMAP_GENERATOR === '1') throw error;
          // In reader-serving workers, one unreachable title must not empty the whole sitemap.
          return [];
        }
      }),
    );

    for (const paths of results) {
      for (const path of paths) {
        // No lastmod: these segment responses contain no modification time.
        urls.push({ loc: localizeSitemapPath(path, locale), changefreq: 'monthly' });
      }
    }
  }

  return urls;
});
