import { resolveMediaSlug } from '~~/server/utils/mediaSlugIndex';

/**
 * The media behind a `/media/<slug>` URL.
 *
 * Two hops rather than one: the slug is resolved against the catalogue index,
 * then the full entry is fetched by publicId. The index holds only the mapping
 * on purpose -- caching whole media objects there would mean a stale banner or
 * episode count for up to an hour, while an id is stable for the life of the
 * title.
 *
 * The answer is identical for every visitor, so it is `swr`-cached in
 * `nuxt.config.ts` alongside the other shared `/api/*` routes.
 */
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
