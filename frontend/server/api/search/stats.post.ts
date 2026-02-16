import { getNadeshikoSdkClient } from '~~/server/utils/nadeshikoSdk';
import { enforcePublicSearchRateLimit } from '~~/server/utils/publicRateLimiter';

export default defineEventHandler(async (event) => {
  enforcePublicSearchRateLimit(event, 'search-stats');
  const body = await readBody(event);
  const sdk = getNadeshikoSdkClient();
  const { data } = await sdk.searchStats({ body });
  return data;
});
