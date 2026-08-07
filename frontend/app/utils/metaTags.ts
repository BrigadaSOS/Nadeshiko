import type { SearchResult, Media } from '~/types/search';

// A union rather than one shape with both keys optional: unhead v3 narrows the
// `meta` entries it accepts, and an all-optional shape matches none of its
// branches -- it falls through to the one demanding `charset`. Every tag we
// build carries exactly one of `name` or `property`, so this is also the more
// honest type.
type MetaTag = { name: string; content: string } | { property: string; content: string };
type MetaTags = { title: string; meta: MetaTag[] };

const TITLE_SUFFIX = ' | Nadeshiko';

export function socialTitle(title: string): string {
  return `${title}${TITLE_SUFFIX}`;
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

export function buildSentenceMetaTags(
  result: SearchResult,
  mediaNameFn: (media: Media) => string,
  episodeLabelFn: (episode: number) => string,
): MetaTags {
  const mediaInfo = episodeLabelFn(result.segment.episode);
  const title = mediaNameFn(result.media);
  const social = socialTitle(title);
  const description = `「${result.segment.textJa.content}」 - ${mediaInfo}`;

  const meta: MetaTag[] = [
    { name: 'description', content: description },
    { property: 'og:title', content: social },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'website' },
    { property: 'og:image', content: result.segment.urls.imageUrl },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: social },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: result.segment.urls.imageUrl },
  ];

  if (result.segment.urls.videoUrl) {
    meta.push(
      { property: 'og:video', content: result.segment.urls.videoUrl },
      { property: 'og:video:type', content: 'video/mp4' },
      { property: 'og:video:width', content: '1280' },
      { property: 'og:video:height', content: '720' },
    );
  }

  return { title, meta };
}
