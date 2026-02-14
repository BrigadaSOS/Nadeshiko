import { getNadeshikoSdkClient, unwrapSdkResult } from '~~/server/utils/nadeshikoSdk';
import { enforcePublicSearchRateLimit } from '~~/server/utils/publicRateLimiter';

export default defineEventHandler(async (event) => {
  enforcePublicSearchRateLimit(event, 'search-segments');
  const body = await readBody(event);
  const sdk = getNadeshikoSdkClient();
  const result = await sdk.searchSegments({ body });

  return unwrapSdkResult('searchSegments', result);
});
