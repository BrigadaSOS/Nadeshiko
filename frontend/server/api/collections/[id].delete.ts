import { getNadeshikoUserClient } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'));
  const sdk = getNadeshikoUserClient(event);
  const { data } = await sdk.deleteCollection({
    path: { id },
  });
  return data;
});
