import { getNadeshikoSdkClient, unwrapSdkResult } from '~~/server/utils/nadeshikoSdk';
import { enforcePublicSearchRateLimit } from '~~/server/utils/publicRateLimiter';

type MediaType = 'anime' | 'liveaction' | 'audiobook';

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

function parseMediaType(value: unknown): MediaType | undefined {
  const raw = firstQueryValue(value);
  if (!raw) {
    return undefined;
  }

  return raw === 'anime' || raw === 'liveaction' || raw === 'audiobook' ? raw : undefined;
}

export default defineEventHandler(async (event) => {
  enforcePublicSearchRateLimit(event, 'search-media-info');
  const query = getQuery(event);
  const sdk = getNadeshikoSdkClient();

  const result = await sdk.fetchMediaInfo({
    query: {
      size: parseNumber(query.size),
      query: firstQueryValue(query.query),
      cursor: parseNumber(query.cursor),
      type: parseMediaType(query.type),
    },
  });

  return unwrapSdkResult('fetchMediaInfo', result);
});
