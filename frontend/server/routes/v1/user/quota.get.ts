import { getNadeshikoUserClient } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const sdk = getNadeshikoUserClient(event);
  const { data } = await sdk.getUserQuota();
  return data;
});
