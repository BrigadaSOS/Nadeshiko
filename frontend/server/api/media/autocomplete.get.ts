import { enforcePublicSearchRateLimit } from '~~/server/utils/publicRateLimiter';
import { $fetch as ofetch } from 'ofetch';

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
  enforcePublicSearchRateLimit(event, 'autocomplete-media');
  const query = getQuery(event);
  const config = useRuntimeConfig();

  const backendInternalUrl = String(config.backendInternalUrl || '');
  const apiKey = String(config.nadeshikoApiKey || '');
  const hostHeader = String(config.backendHostHeader || '');

  if (!backendInternalUrl || !apiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Missing backend configuration',
    });
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };

  if (hostHeader) {
    headers.Host = hostHeader;
  }

  return await ofetch(`${backendInternalUrl}/v1/media/autocomplete`, {
    method: 'GET',
    headers,
    params: {
      query: firstQueryValue(query.query),
      limit: parseNumber(query.limit),
      category: parseCategory(query.category),
    },
  });
});
