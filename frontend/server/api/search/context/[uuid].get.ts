import { getNadeshikoSdkClient } from '~~/server/utils/nadeshikoSdk';
import { enforcePublicSearchRateLimit } from '~~/server/utils/publicRateLimiter';

export default defineEventHandler(async (event) => {
  enforcePublicSearchRateLimit(event, 'search-context');
  const uuid = getRouterParam(event, 'uuid')!;
  const query = getQuery(event);
  const sdk = getNadeshikoSdkClient();
  const { data } = await sdk.segmentContextShow({
    path: { uuid },
    query: { limit: query.limit ? Number(query.limit) : undefined },
  });
  return data;
});
