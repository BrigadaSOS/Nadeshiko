import { stableCacheKey } from '~~/server/utils/cacheKey';
import { resolveMediaSlug } from '~~/server/utils/mediaSlugIndex';

// The hour-long index stores only stable slug-to-ID mappings; fetch media details separately so banners/counts
// do not inherit that staleness.
const handler = defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug');

  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'Missing media slug' });
  }

  const publicId = await resolveMediaSlug(slug, event);

  if (!publicId) {
    throw createError({ statusCode: 404, statusMessage: 'Media Not Found' });
  }

  return await useServerSdk(event).getMedia(publicId);
});

// Cache visitor-independent slug resolution for a day; new titles use the slug index miss path rather than
// waiting for expiry (server/utils/mediaSlugIndex.ts). Key by slug alone: misses are 404s, which Nitro never
// stores, so only real titles occupy entries and query strings cannot multiply them.
export default defineCachedEventHandler(handler, {
  name: 'media-by-slug',
  swr: true,
  maxAge: 86400,
  getKey: (event) => stableCacheKey(getRouterParam(event, 'slug') ?? ''),
});
