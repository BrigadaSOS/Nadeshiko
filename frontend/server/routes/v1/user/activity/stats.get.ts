import { getNadeshikoSdkClient, getUserAuthHeaders } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const sdk = getNadeshikoSdkClient();
  const { data } = await sdk.userActivityStatsShow({
    headers: getUserAuthHeaders(event),
  });
  return data;
});
