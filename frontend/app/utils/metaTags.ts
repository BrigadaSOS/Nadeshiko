import type { MediaSearchStats } from '@brigadasos/nadeshiko-sdk';
import type { SearchResult, Media } from '~/types/search';

// Unhead requires either `name` or `property`; an all-optional shape fails its union narrowing.
type MetaTag = { name: string; content: string } | { property: string; content: string };
type MetaTags = { title: string; meta: MetaTag[] };

const TITLE_SUFFIX = ' | Nadeshiko';

/**
 * Social titles need their own brand suffix because `og:title` does not pass through the site-wide title
 * template.
 */
export function socialTitle(title: string): string {
  return `${title}${TITLE_SUFFIX}`;
}

/**
 * Leave the brand to the site-wide `<title>` template to avoid duplication. Callers supply localized
 * headlines and should allow room for the suffix.
 */
export function pageTitle(headline: string): string {
  return headline;
}

/**
 * Trims a sentence down to something a `<title>` can carry whole.
 *
 * Cuts on a character count rather than a word boundary because the text is
 * Japanese, which has no spaces to break on.
 */
export function truncateForTitle(text: string, max = 40): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/** The site-wide share card, and the one image whose size never varies. */
export const DEFAULT_OG_IMAGE_PATH = '/logo-og-5bc76788.png';
export const DEFAULT_OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/** Clip stills are 960x540; their videos are 1280x720. Do not reuse one asset's dimensions for the other. */
export const CLIP_IMAGE_SIZE = { width: 960, height: 540 } as const;

type ImageSize = { readonly width: number; readonly height: number };

/**
 * Declare image dimensions only when known for this URL; banner heights vary. Unhead deduplicates individual
 * tags, so a fallback layer must not leave width/height describing an image another page replaced.
 */
export function buildOgImageTags(url: string, size?: ImageSize): MetaTag[] {
  const tags: MetaTag[] = [
    { property: 'og:image', content: url },
    { name: 'twitter:image', content: url },
  ];

  if (size) {
    tags.push(
      { property: 'og:image:width', content: `${size.width}` },
      { property: 'og:image:height', content: `${size.height}` },
    );
  }

  return tags;
}

/**
 * The tag set every page starts from: description plus the Open Graph and Twitter
 * card fields, all carrying the same title and description.
 *
 * Both search and sentence pages built this list inline and identically, so a tag
 * added for one crawler on one page silently missed the other.
 */
export function buildDefaultMetaTags(title: string, description: string): MetaTags {
  const social = socialTitle(title);

  return {
    title,
    meta: [
      { name: 'description', content: description },
      { property: 'og:title', content: social },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: social },
      { name: 'twitter:description', content: description },
    ],
  };
}

type MediaMetaInput = {
  name: string;
  bannerUrl?: string | null;
  origin: string;
  totalResults: number;
  episodeHits?: MediaSearchStats['episodeHits'];
  episode: number | null;
};

/** Shared media-browse metadata; callers retain scope selection and count defaults. */
export function buildMediaMetaTags(
  { name, bannerUrl, origin, totalResults, episodeHits, episode }: MediaMetaInput,
  t: (key: string, params: Record<string, string | number>) => string,
  formatNumber: (value: number) => string,
): MetaTags {
  // Preserve the existing truthy episode rule: zero is treated as unfiltered.
  if (episodeHits && episode) {
    totalResults = episodeHits.find((hit) => hit.episode === episode)?.hitCount ?? 0;
  }

  const count = formatNumber(totalResults);
  let description = t('seo.search.mediaDescription', { count, media: name });
  if (episodeHits && episodeHits.length > 0) {
    description = episode
      ? t('seo.search.mediaDescriptionEpisode', { count, media: name, episode })
      : t('seo.search.mediaDescriptionEpisodes', { count, media: name, episodeCount: episodeHits.length });
  }

  const social = socialTitle(name);
  return {
    title: pageTitle(t('seo.media.pageTitle', { media: name })),
    meta: [
      { name: 'description', content: description },
      { property: 'og:title', content: social },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'website' },
      // Banners have varying heights; use the known dimensions only for the
      // default card. A portrait cover is deliberately never a fallback.
      ...buildOgImageTags(
        bannerUrl || `${origin}${DEFAULT_OG_IMAGE_PATH}`,
        bannerUrl ? undefined : DEFAULT_OG_IMAGE_SIZE,
      ),
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: social },
      { name: 'twitter:description', content: description },
    ],
  };
}

/**
 * Include the sentence in page titles so permalinks from one show are distinguishable. Keep social titles
 * short because the description already contains the sentence.
 */
export function buildSentenceMetaTags(
  result: SearchResult,
  mediaNameFn: (media: Media) => string,
  episodeLabelFn: (episode: number) => string,
  pageTitleFn?: (sentence: string, media: string) => string,
): MetaTags {
  const mediaInfo = episodeLabelFn(result.segment.episode);
  const name = mediaNameFn(result.media);
  const social = socialTitle(name);
  const sentence = result.segment.textJa.content;
  const title = pageTitleFn ? pageTitle(pageTitleFn(truncateForTitle(sentence), name)) : social;
  const description = `「${sentence}」 - ${mediaInfo}`;

  const videoUrl = result.segment.urls.videoUrl;

  const meta: MetaTag[] = [
    { name: 'description', content: description },
    { property: 'og:title', content: social },
    { property: 'og:description', content: description },
    // `video.other` only when there is a video to back it up: the type is a
    // promise that the `og:video:*` block below exists, and a segment without a
    // clip is still a perfectly good page -- just a `website` one.
    { property: 'og:type', content: videoUrl ? 'video.other' : 'website' },
    ...buildOgImageTags(result.segment.urls.imageUrl, CLIP_IMAGE_SIZE),
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: social },
    { name: 'twitter:description', content: description },
  ];

  if (videoUrl) {
    meta.push(
      { property: 'og:video', content: videoUrl },
      // Verified against the CDN rather than inherited from the still: the clips
      // really are 1280x720 while their thumbnails are 960x540.
      { property: 'og:video:type', content: 'video/mp4' },
      { property: 'og:video:width', content: '1280' },
      { property: 'og:video:height', content: '720' },
    );
  }

  return { title, meta };
}
