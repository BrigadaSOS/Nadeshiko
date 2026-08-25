import type { SitemapUrlInput } from '#sitemap/types';
import { buildSentencePath } from '~/utils/routes';
import { getSitemapLocale, localizeSitemapPath } from './utils';

/**
 * `/sentence/<id>`, a bounded sample of the permalinks themselves.
 *
 * WHY THIS EXISTS NOW, when `episodes.ts` deliberately stopped short of it.
 * That call was right on cost and wrong on value, and Search Console settled it
 * over the 3 months to 2026-08-25. Sentence permalinks are the single largest
 * source of impressions on the site -- 43.7% of them, across 663 URLs that
 * reached the index with no sitemap entry at all, purely by being crawled from
 * episode pages. Per URL that actually got indexed they earn 0.585 clicks,
 * against 0.386 for a word search page. The template was already carrying the
 * site; it was the only one being asked to find its own way in.
 *
 * STILL NOT ALL 1.3M, and for exactly the reason `episodes.ts` gives: the corpus
 * cannot be paginated through the API on every sitemap build, and the thinnest
 * pages here should not be the ones spending the crawl budget. This submits the
 * opening `SEGMENTS_PER_TITLE` of ONE episode per title -- a sample proportional
 * to the catalogue, not to the corpus, which is the same shape `episodes.ts`
 * settled on. At ~320 titles that is ~9,600 URLs, and `SEGMENTS_PER_TITLE` is
 * the one number to turn if that should grow.
 *
 * THE FIRST EPISODE THE API REPORTS, not episode 1. Episode numbers are not
 * always 1..n -- movies and specials are 0 -- so the number is read rather than
 * assumed, the same trap `episodes.ts` documents. `take: 1` because only the
 * first is wanted: this is a cheap lookup, not a pagination.
 *
 * ACTIVE SEGMENTS ONLY. `HIDDEN` and `DELETED` render as a permalink to nothing,
 * and a sitemap is the one place a URL should never be a guess.
 *
 * SAFE AND SUGGESTIVE ONLY. A sitemap is an active invitation rather than a
 * statement that a page exists, and the ratings above that change how a domain
 * gets classified for everything else it hosts. `QUESTIONABLE` and `EXPLICIT`
 * permalinks stay live and stay crawlable from their episode pages -- this
 * decides what the site pushes, not what it serves. `SITEMAP_RATINGS` is the
 * toggle if that judgement should go the other way.
 */
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
        } catch {
          // One unreachable title costs its own sentences, not the sitemap --
          // the same bargain `episodes.ts` strikes, and for the same reason: a
          // source that throws returns nothing at all, and a sitemap that
          // silently shrinks to zero is worse than one missing a show.
          return [];
        }
      }),
    );

    for (const paths of results) {
      for (const path of paths) {
        // No `lastmod`. A segment carries no modification time here, and an
        // invented one gets the hint discounted site-wide -- see `media.ts`.
        urls.push({ loc: localizeSitemapPath(path, locale), changefreq: 'monthly' });
      }
    }
  }

  return urls;
});
