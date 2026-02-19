import type { SearchResult, SearchResultMedia } from '~/stores/search';

type MetaTag = { name?: string; property?: string; content: string };
type MetaTags = { title: string; meta: MetaTag[] };

export function buildSentenceMetaTags(
  result: SearchResult,
  mediaNameFn: (media: SearchResultMedia) => string,
): MetaTags {
  const mediaInfo = `Episode ${result.segment.episode}`;
  const title = `${mediaNameFn(result.media)} | Nadeshiko`;
  const description = `「${result.segment.textJa.content}」 - ${mediaInfo}`;

  const meta: MetaTag[] = [
    { name: 'description', content: description },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'website' },
    { property: 'og:image', content: result.urls.imageUrl },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: result.urls.imageUrl },
  ];

  if (result.urls.videoUrl) {
    meta.push(
      { property: 'og:video', content: result.urls.videoUrl },
      { property: 'og:video:type', content: 'video/mp4' },
      { property: 'og:video:width', content: '1280' },
      { property: 'og:video:height', content: '720' },
    );
  }

  return { title, meta };
}
