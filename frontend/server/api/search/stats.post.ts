import { enforcePublicSearchRateLimit } from '~~/server/utils/publicRateLimiter';

export default defineEventHandler(async (event) => {
  enforcePublicSearchRateLimit(event, 'search-stats');
  const body = await readBody(event);
  const config = useRuntimeConfig();

  // Direct fetch to backend since SDK doesn't have this method yet
  const backendUrl = config.backendInternalUrl;
  const apiKey = config.nadeshikoApiKey;

  if (!backendUrl || !apiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Backend configuration missing',
    });
  }

  const response = await $fetch(`${backendUrl}/v1/search/stats`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body,
  });

  return response;
});
