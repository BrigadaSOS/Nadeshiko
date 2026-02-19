import { getNadeshikoSdkClient } from '~~/server/utils/nadeshikoSdk';
import { enforcePublicSearchRateLimit } from '~~/server/utils/publicRateLimiter';
import { normalizeSearchRequest } from '~~/server/utils/searchSdkNormalizer';

function emptySearchResponse() {
  return {
    segments: [],
    includes: { media: {} },
    pagination: {
      hasMore: false,
      estimatedTotalHits: 0,
      estimatedTotalHitsRelation: 'EXACT' as const,
    },
  };
}

export default defineEventHandler(async (event) => {
  enforcePublicSearchRateLimit(event, 'search-segments');
  const rawBody = (await readBody(event)) as Record<string, unknown>;
  const legacyUuid = typeof rawBody.uuid === 'string' ? rawBody.uuid.trim() : '';
  const body = normalizeSearchRequest(rawBody);
  const sdk = getNadeshikoSdkClient();

  // Legacy compatibility for `/sentence/:uuid` flows that previously used `{ uuid }`.
  if (legacyUuid) {
    try {
      const { data: segment } = await sdk.getSegmentByUuid({ path: { uuid: legacyUuid } });
      if (!segment) {
        return emptySearchResponse();
      }

      const contentRatingFilter = body.filters?.contentRating;
      if (contentRatingFilter?.length && !contentRatingFilter.includes(segment.contentRating)) {
        return emptySearchResponse();
      }

      const { data: media } = await sdk.getMedia({ path: { id: segment.mediaId }, query: { include: ['media'] } });
      return {
        segments: [segment],
        includes: { media: media ? { [String(segment.mediaId)]: media } : {} },
        pagination: {
          hasMore: false,
          estimatedTotalHits: 1,
          estimatedTotalHitsRelation: 'EXACT' as const,
        },
      };
    } catch (error: unknown) {
      const err = error as { statusCode?: number };
      if (err.statusCode === 404) {
        return emptySearchResponse();
      }
      throw error;
    }
  }

  const { data } = await sdk.search({ body });
  return data;
});
