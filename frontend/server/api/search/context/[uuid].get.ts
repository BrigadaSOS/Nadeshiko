import { getNadeshikoSdkClient } from '~~/server/utils/nadeshikoSdk';
import { enforcePublicSearchRateLimit } from '~~/server/utils/publicRateLimiter';

export default defineEventHandler(async (event) => {
  enforcePublicSearchRateLimit(event, 'search-context');
  const uuid = getRouterParam(event, 'uuid');
  if (!uuid) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing uuid parameter',
    });
  }
  const query = getQuery(event);
  const sdk = getNadeshikoSdkClient();
  const { data } = await sdk.segmentContextShow({
    path: { uuid },
    query: {
      limit: query.limit ? Number(query.limit) : undefined,
      ...(query.contentRating && { contentRating: String(query.contentRating).split(',') }),
    } as Record<string, unknown>,
  });
  return data;
});
