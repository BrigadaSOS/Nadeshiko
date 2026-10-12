import { resolveMediaSlug } from '~~/server/utils/mediaSlugIndex';

// The hour-long index stores only stable slug-to-ID mappings; fetch media details separately so banners/counts
// do not inherit that staleness. The shared response is SWR-cached by route policy.
export default defineEventHandler(async (event) => {
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
