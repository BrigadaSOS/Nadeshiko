import { useNadeshikoClient } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'));
  const sdk = useNadeshikoClient(event);

  // Fetch all segments from the collection by paging through
  const allSegments: Array<{ mediaId: number; episode: number }> = [];
  let mediaIncludes: Record<string, Record<string, unknown>> = {};
  let cursor: number | undefined;

  do {
    const { data } = await sdk.getCollection({
      path: { id },
      query: { cursor, limit: 100 },
    });

    if (!data) break;

    for (const entry of data.segments ?? []) {
      const seg = (entry as any).result;
      if (seg?.mediaId != null) {
        allSegments.push({ mediaId: seg.mediaId, episode: seg.episode ?? 0 });
      }
    }

    // Merge includes
    if (data.includes?.media) {
      mediaIncludes = { ...mediaIncludes, ...(data.includes.media as Record<string, Record<string, unknown>>) };
    }

    const hasMore = data.pagination?.hasMore ?? false;
    cursor = (data.pagination?.cursor as number | undefined) ?? undefined;
    if (!hasMore || cursor == null) break;
    // biome-ignore lint/correctness/noConstantCondition: pagination loop
  } while (true);

  // Compute per-media stats
  const mediaMap = new Map<number, { segmentCount: number; episodeHits: Record<string, number> }>();
  const categoryCountMap = new Map<string, number>();

  for (const seg of allSegments) {
    // Per-media
    let entry = mediaMap.get(seg.mediaId);
    if (!entry) {
      entry = { segmentCount: 0, episodeHits: {} };
      mediaMap.set(seg.mediaId, entry);
    }
    entry.segmentCount++;
    const epKey = String(seg.episode);
    entry.episodeHits[epKey] = (entry.episodeHits[epKey] ?? 0) + 1;

    // Per-category
    const mediaInfo = mediaIncludes[String(seg.mediaId)] as Record<string, unknown> | undefined;
    const category = (mediaInfo?.category as string) ?? 'ANIME';
    categoryCountMap.set(category, (categoryCountMap.get(category) ?? 0) + 1);
  }

  // Build response in same shape as search stats
  const media = Array.from(mediaMap.entries()).map(([mediaId, stats]) => {
    const info = mediaIncludes[String(mediaId)] as Record<string, unknown> | undefined;
    return {
      mediaId,
      category: (info?.category as string) ?? 'ANIME',
      nameRomaji: (info?.nameRomaji as string) ?? '',
      nameEn: (info?.nameEn as string) ?? '',
      nameJa: (info?.nameJa as string) ?? '',
      segmentCount: stats.segmentCount,
      episodeHits: stats.episodeHits,
    };
  });

  const categories = Array.from(categoryCountMap.entries()).map(([category, count]) => ({
    category,
    count,
  }));

  return { media, categories };
});
