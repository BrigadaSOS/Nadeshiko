import { getNadeshikoSdkClient, getUserAuthHeaders } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const sdk = getNadeshikoSdkClient();
  const { data } = await sdk.labIndex({
    headers: getUserAuthHeaders(event),
  });
  return data;
});
