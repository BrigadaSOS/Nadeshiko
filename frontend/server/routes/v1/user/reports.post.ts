import { useNadeshikoClient } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const sdk = useNadeshikoClient(event);
  const { data } = await sdk.createUserReport({ body });
  return data;
});
