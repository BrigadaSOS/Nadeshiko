import { useNadeshikoClient } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'));
  const uuid = getRouterParam(event, 'uuid') ?? '';
  const body = await readBody(event);
  const sdk = useNadeshikoClient(event);
  const { data } = await sdk.updateCollectionSegment({
    path: { id, uuid },
    body,
  });
  return data;
});
