import type { SearchResult, Media } from '~/types/search';

type MetaTag = { name?: string; property?: string; content: string };
type MetaTags = { title: string; meta: MetaTag[] };

export function buildSentenceMetaTags(result: SearchResult, mediaNameFn: (media: Media) => string): MetaTags {
  const mediaInfo = `Episode ${result.segment.episode}`;
  const title = mediaNameFn(result.media);
  const description = `「${result.segment.textJa.content}」 - ${mediaInfo}`;

  const meta: MetaTag[] = [
    { name: 'description', content: description },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'website' },
    { property: 'og:image', content: result.segment.urls.imageUrl },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
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
