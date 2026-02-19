import { useNadeshikoClient } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'));
  const query = getQuery(event);
  const sdk = useNadeshikoClient(event);
  const { data } = await sdk.getCollection({
    path: { id },
    query: {
      page: query.page ? Number(query.page) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    },
  });
  return data;
});
