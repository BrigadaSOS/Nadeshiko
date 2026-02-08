export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  return backendFetch('/v1/search/media/context', {
    method: 'POST',
    body,
  });
});
