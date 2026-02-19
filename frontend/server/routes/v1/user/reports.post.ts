import { getNadeshikoUserClient } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const sdk = getNadeshikoUserClient(event);
  const { data } = await sdk.createUserReport({ body });
  return data;
});
