import { getNadeshikoUserClient } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'));
  const query = getQuery(event);

  const cursor = query.cursor ? Number(query.cursor) : undefined;
  const limit = query.limit ? Number(query.limit) : 20;

  const sdk = getNadeshikoUserClient(event);
  const { data } = await sdk.getCollection({
    path: { id },
    query: {
      cursor,
      limit,
    },
  });

  if (!data) {
    return {
      segments: [],
      includes: {},
      pagination: { hasMore: false, cursor: null, estimatedTotalHits: 0, estimatedTotalHitsRelation: 'EXACT' },
    };
  }

  const segments = (data.segments ?? [])
    .map((entry: any) => {
      if (!entry.result) return null;
      return entry.result;
    })
    .filter(Boolean);

  return {
    segments,
    includes: data.includes ?? {},
    pagination: {
      hasMore: data.pagination?.hasMore ?? false,
      cursor: data.pagination?.cursor ?? null,
      estimatedTotalHits: data.totalCount ?? 0,
      estimatedTotalHitsRelation: 'EXACT',
    },
  };
});
