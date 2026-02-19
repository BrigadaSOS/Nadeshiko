import { getNadeshikoUserClient } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'));
  const body = await readBody(event);
  const sdk = getNadeshikoUserClient(event);
  const { data } = await sdk.updateCollection({
    path: { id },
    body,
  });
  return data;
});
