import { NadeshikoError } from '@brigadasos/nadeshiko-sdk';
import { stableCacheKey } from '~~/server/utils/cacheKey';
import { resolveMediaSlug, resolveStaleMediaSlug } from '~~/server/utils/mediaSlugIndex';

const isNotFound = (error: unknown) => error instanceof NadeshikoError && error.status === 404;

// The hour-long index stores only slug-to-ID mappings; media details are fetched here so banners/counts come from
// the API rather than from the index.
const handler = defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug');

  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'Missing media slug' });
  }

  const publicId = await resolveMediaSlug(slug, event);

  if (!publicId) {
    throw createError({ statusCode: 404, statusMessage: 'Media Not Found' });
  }

  const sdk = useServerSdk(event);
  try {
    return await sdk.getMedia(publicId);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    // The index still maps the slug to a deleted title (deleted, then uploaded again under the same slug).
    const current = await resolveStaleMediaSlug(slug, publicId, event);
    if (!current) throw createError({ statusCode: 404, statusMessage: 'Media Not Found' });
    return await sdk.getMedia(current);
  }
});

// Visitor-independent, so shared and keyed by slug alone: misses are 404s, which Nitro never stores, so only real
// titles occupy entries and query strings cannot multiply them. Five minutes rather than a day: the response
// carries the sentence count and the publicId the page searches with, and a day-long entry kept serving a deleted
// title (and its stale count) after it was re-uploaded, so every search on its page failed. New titles still use
// the slug index miss path rather than waiting for expiry (server/utils/mediaSlugIndex.ts).
export default defineCachedEventHandler(handler, {
  name: 'media-by-slug',
  swr: true,
  maxAge: 300,
  getKey: (event) => stableCacheKey(getRouterParam(event, 'slug') ?? ''),
});
