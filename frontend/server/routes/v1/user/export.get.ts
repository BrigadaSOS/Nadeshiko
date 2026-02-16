import { getNadeshikoSdkClient, getUserAuthHeaders } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const sdk = getNadeshikoSdkClient();
  const { data } = await sdk.userExportShow({
    headers: getUserAuthHeaders(event),
  });
  return data;
});
