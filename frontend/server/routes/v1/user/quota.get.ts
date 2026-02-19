import { useNadeshikoClient } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const sdk = useNadeshikoClient(event);
  const { data } = await sdk.getUserQuota();
  return data;
});
