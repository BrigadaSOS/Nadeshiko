import { getNadeshikoSdkClient } from '~~/server/utils/nadeshikoSdk';
import { enforcePublicSearchRateLimit } from '~~/server/utils/publicRateLimiter';

export default defineEventHandler(async (event) => {
  enforcePublicSearchRateLimit(event, 'search-segments');
  const body = await readBody(event);
  const sdk = getNadeshikoSdkClient();
  const { data } = await sdk.searchIndex({ body });
  return data;
});
