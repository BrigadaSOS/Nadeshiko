import { getNadeshikoSdkClient } from '~~/server/utils/nadeshikoSdk';
import { enforcePublicSearchRateLimit } from '~~/server/utils/publicRateLimiter';
import { normalizeSearchWordsBody } from '~~/server/utils/searchSdkNormalizer';

export default defineEventHandler(async (event) => {
  enforcePublicSearchRateLimit(event, 'search-words');
  const body = normalizeSearchWordsBody(await readBody(event));
  const sdk = getNadeshikoSdkClient();
  const { data } = await sdk.searchWords({ body });
  return data;
});
