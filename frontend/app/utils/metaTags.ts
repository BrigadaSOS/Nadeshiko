import type { SearchResult, Media } from '~/types/search';

// A union rather than one shape with both keys optional: unhead v3 narrows the
// `meta` entries it accepts, and an all-optional shape matches none of its
// branches -- it falls through to the one demanding `charset`. Every tag we
// build carries exactly one of `name` or `property`, so this is also the more
// honest type.
type MetaTag = { name: string; content: string } | { property: string; content: string };
type MetaTags = { title: string; meta: MetaTag[] };

const TITLE_SUFFIX = ' | Nadeshiko';

const withBrand = (headline: string) => `${headline}${TITLE_SUFFIX}`;

/**
 * The name on a share card. Deliberately just the subject plus the brand: a
 * social preview already carries a description underneath, so a long headline
 * only gets truncated by the platform.
 */
export function socialTitle(title: string): string {
  return withBrand(title);
}

/**
 * The `<title>`, which is a different job from the share card and now says so.
 *
 * These used to be the same string, so a word page's `<title>` was the bare word
 * -- `食べる`, and nothing else. That is the headline for ~19.8k of the site's
 * indexed pages and it carried no brand, no language, and none of the words
 * anyone actually types alongside a term they are looking up. The share card had
 * the brand; the search result did not.
 *
 * The headline comes from a translated string per page type (`seo.*.pageTitle`),
 * so what each one adds is editable per locale, and the brand is appended here
 * rather than baked into thirty translations.
 *
 * Kept short on purpose: search engines truncate around 60 characters, and the
 * subject has to survive that, so the suffix is the part that gets dropped.
 */
export function pageTitle(headline: string): string {
  return withBrand(headline);
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

/**
 * Every clip still is rendered at this size (measured off the CDN, not assumed:
 * `/media/10165/26/7328591300.webp` and friends are all 960x540). The clip VIDEO
 * is 1280x720 -- a different number for a different asset, which is exactly why
 * one global size for both was wrong.
 */
export const CLIP_IMAGE_SIZE = { width: 960, height: 540 } as const;

type ImageSize = { readonly width: number; readonly height: number };

/**
 * The `og:image` family, kept together so a page cannot state one without the
 * other two.
 *
 * `og:image:width`/`:height` used to be declared ONCE, globally, in
 * `nuxt.config.ts` -- as 1200x630, the size of the default card above. Every page
 * that overrode `og:image` with a real asset (a clip still, a media banner) left
 * that pair behind, so it went on describing an image that was no longer there.
 * Facebook, Twitter and Discord all lay the card out from the declared size
 * before the bytes arrive, so the two most-shared page types on the site --
 * sentence permalinks and media pages -- rendered mis-cropped.
 *
 * `size` is therefore optional and must stay that way: media banners are 1200
 * wide but 391-400 tall depending on the title, and some media have no banner at
 * all. Omitting the pair makes crawlers fetch and measure, which is slower and
 * completely correct. Guessing within nine pixels would just be the same bug
 * with a smaller error bar.
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

/**
 * `pageTitleFn` receives the trimmed sentence and the title it came from, and is
 * what stops every permalink of one show from sharing a `<title>`.
 *
 * That was the state before: the headline was the media name alone, so a show
 * with four thousand indexed sentences offered four thousand pages called
 * "Steins;Gate" -- indistinguishable in a search result, and exactly the pattern
 * that reads as duplicate content. The sentence is the only thing that differs
 * between those pages, so the sentence has to be in the headline.
 *
 * The share card keeps the short form: a preview shows the sentence in its
 * description already, and repeating it in the headline just gets truncated.
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
