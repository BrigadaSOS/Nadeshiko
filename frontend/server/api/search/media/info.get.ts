export default defineEventHandler(async (event) => {
  const query = getQuery(event);

  return backendFetch('/v1/search/media/info', {
    method: 'GET',
    params: {
      size: query.size,
      sorted: query.sorted,
      query: query.query,
      cursor: query.cursor,
      type: query.type,
    },
  });
});
