import { useNadeshikoClient } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'));
  const body = await readBody(event);
  const sdk = useNadeshikoClient(event);
  const { data } = await sdk.updateCollection({
    path: { id },
    body,
  });
  return data;
});
