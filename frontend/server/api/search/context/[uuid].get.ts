import { getNadeshikoSdkClient } from '~~/server/utils/nadeshikoSdk';
import { enforcePublicSearchRateLimit } from '~~/server/utils/publicRateLimiter';

type ContentRating = 'SAFE' | 'SUGGESTIVE' | 'QUESTIONABLE' | 'EXPLICIT';

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first : undefined;
  }

  return typeof value === 'string' ? value : undefined;
}

function parseNumber(value: unknown): number | undefined {
  const raw = firstQueryValue(value);
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseContentRatings(value: unknown): ContentRating[] | undefined {
  const raw = firstQueryValue(value);
  if (!raw) {
    return undefined;
  }

  const ratings = raw
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(
      (item): item is ContentRating =>
        item === 'SAFE' || item === 'SUGGESTIVE' || item === 'QUESTIONABLE' || item === 'EXPLICIT',
    );

  return ratings.length > 0 ? ratings : undefined;
}

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
  const { data } = await sdk.getSegmentContext({
    path: { uuid },
    query: {
      limit: parseNumber(query.limit),
      contentRating: parseContentRatings(query.contentRating),
      include: ['media'],
    },
  });
  return data;
});
