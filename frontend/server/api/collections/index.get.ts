import { getNadeshikoUserClient } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const sdk = getNadeshikoUserClient(event);
  const { data } = await sdk.listCollections({
    query: {
      limit: query.limit ? Number(query.limit) : undefined,
      visibility: query.visibility as 'public' | 'private' | undefined,
    },
  });
  return data;
});
