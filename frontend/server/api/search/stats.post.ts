import { getNadeshikoSdkClient } from '~~/server/utils/nadeshikoSdk';
import { enforcePublicSearchRateLimit } from '~~/server/utils/publicRateLimiter';
import { normalizeSearchStatsRequest } from '~~/server/utils/searchSdkNormalizer';

export default defineEventHandler(async (event) => {
  enforcePublicSearchRateLimit(event, 'search-stats');
  const body = normalizeSearchStatsRequest(await readBody(event));
  const sdk = getNadeshikoSdkClient();
  const { data } = await sdk.getSearchStats({ body });
  return data;
});
