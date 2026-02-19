import { getNadeshikoUserClient } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'));
  const uuid = getRouterParam(event, 'uuid') ?? '';
  const sdk = getNadeshikoUserClient(event);
  const { data } = await sdk.removeSegmentFromCollection({
    path: { id, uuid },
  });
  return data;
});
