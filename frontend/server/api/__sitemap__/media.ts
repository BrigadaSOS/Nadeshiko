import type { SitemapUrlInput } from '#sitemap/types';

interface Media {
  publicId: string;
  nameEn: string | null;
}

interface MediaListResponse {
  media: Media[];
  pagination: {
    hasMore: boolean;
    cursor: string | null;
  };
}

export default defineSitemapEventHandler(async () => {
  const config = useRuntimeConfig();
  const baseUrl = (config.backendInternalUrl as string).replace(/\/$/, '');
  const apiKey = config.nadeshikoApiKey as string;

  const allMedia: Media[] = [];
  let cursor: string | null = null;

  do {
    const params = new URLSearchParams({ take: '40' });
    if (cursor) params.set('cursor', cursor);

    const response = await $fetch<MediaListResponse>(`${baseUrl}/v1/media?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    allMedia.push(...response.media);
    cursor = response.pagination.hasMore ? response.pagination.cursor : null;
  } while (cursor);

  return allMedia.map(
    (media) =>
      ({
        loc: `/search?media=${media.publicId}`,
        changefreq: 'weekly',
      }) satisfies SitemapUrlInput,
  );
});
