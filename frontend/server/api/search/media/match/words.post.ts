export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  return backendFetch('/v1/search/media/match/words', {
    method: 'POST',
    body,
  });
});
