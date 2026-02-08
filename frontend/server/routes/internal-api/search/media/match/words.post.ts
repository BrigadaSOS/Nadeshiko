import { getNadeshikoSdkClient, unwrapSdkResult } from '~~/server/utils/nadeshikoSdk';
import { enforcePublicSearchRateLimit } from '~~/server/utils/publicRateLimiter';

export default defineEventHandler(async (event) => {
  enforcePublicSearchRateLimit(event, 'search-words');
  const body = await readBody(event);
  const sdk = getNadeshikoSdkClient();
  const result = await sdk.searchMultiple({ body });

  return unwrapSdkResult('searchMultiple', result);
});
