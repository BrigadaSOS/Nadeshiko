export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const baseUrl = 'https://nadeshiko.co';
  const backendUrl = config.public.baseURLBackend || 'https://api.nadeshiko.co/api/v1/';

  // Static pages
  const staticPages = [
    { loc: '/', priority: '1.0', changefreq: 'daily' },
    { loc: '/search/sentence', priority: '0.9', changefreq: 'daily' },
    { loc: '/search/media', priority: '0.8', changefreq: 'weekly' },
    { loc: '/api/v1/docs', priority: '0.5', changefreq: 'monthly' },
  ];

  // Fetch media entries for dynamic pages
  let mediaPages: { loc: string; priority: string; changefreq: string; lastmod?: string }[] = [];

  try {
    // Fetch all media in batches
    let cursor = 0;
    const batchSize = 100;
    let hasMore = true;
    const allMedia: any[] = [];

    while (hasMore) {
      const response = await $fetch<any>(`${backendUrl}search/media/info`, {
        method: 'GET',
        params: {
          size: batchSize,
          sorted: true,
          cursor: cursor,
        },
      });

      if (response.results && response.results.length > 0) {
        allMedia.push(...response.results);
        cursor += batchSize;
        hasMore = response.hasMoreResults;
      } else {
        hasMore = false;
      }

      // Safety limit to prevent infinite loops
      if (allMedia.length > 10000) {
        break;
      }
    }

    mediaPages = allMedia.map((media) => ({
      loc: `/search/sentence?media=${media.id}`,
      priority: '0.7',
      changefreq: 'weekly',
      lastmod: media.updated_at ? new Date(media.updated_at).toISOString().split('T')[0] : undefined,
    }));
  } catch (error) {
    console.error('Error fetching media for sitemap:', error);
  }

  const allPages = [...staticPages, ...mediaPages];

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allPages.map((page) => `  <url>
    <loc>${baseUrl}${page.loc}</loc>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>${page.lastmod ? `
    <lastmod>${page.lastmod}</lastmod>` : ''}
  </url>`).join('\n')}
</urlset>`;

  setHeader(event, 'Content-Type', 'application/xml');
  return sitemap;
});
