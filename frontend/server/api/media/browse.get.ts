import { getNadeshikoSdkClient } from '~~/server/utils/nadeshikoSdk';
import { enforcePublicSearchRateLimit } from '~~/server/utils/publicRateLimiter';

type Category = 'ANIME' | 'JDRAMA';

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

function parseCategory(value: unknown): Category | undefined {
  const raw = firstQueryValue(value);
  if (!raw) {
    return undefined;
  }

  return raw === 'ANIME' || raw === 'JDRAMA' ? raw : undefined;
}

export default defineEventHandler(async (event) => {
  enforcePublicSearchRateLimit(event, 'browse-media');
  const query = getQuery(event);
  const sdk = getNadeshikoSdkClient();

  const { data } = await sdk.mediaIndex({
    query: {
      limit: parseNumber(query.limit),
      query: firstQueryValue(query.query),
      cursor: parseNumber(query.cursor),
      category: parseCategory(query.category),
    },
  });

  return data;
});
