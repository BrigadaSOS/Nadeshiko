import { enforcePublicSearchRateLimit } from '~~/server/utils/publicRateLimiter';

export default defineEventHandler(async (event) => {
  enforcePublicSearchRateLimit(event, 'autocomplete-media');
  const query = getQuery(event);

  const sdk = getNadeshikoSdkClient();

  // TODO: Replace with sdk.autocompleteMedia() once the SDK is rebuilt with the new OpenAPI spec.
  const { data, error } = await sdk.client.get({
    url: '/v1/media/autocomplete',
    query: {
      query: String(query.query ?? ''),
      limit: query.limit ? Number(query.limit) : undefined,
      category: query.category as 'ANIME' | 'JDRAMA' | undefined,
    },
  });

  if (error) {
    throw createError({ statusCode: 500, statusMessage: 'Autocomplete request failed' });
  }

  return data;
});
