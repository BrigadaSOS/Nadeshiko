import { useNadeshikoClient } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'));
  const sdk = useNadeshikoClient(event);
  const { data } = await sdk.deleteCollection({
    path: { id },
  });
  return data;
});
