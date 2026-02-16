import { getNadeshikoSdkClient, getUserAuthHeaders } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const sdk = getNadeshikoSdkClient();
  const { data } = await sdk.userPreferencesUpdate({
    body,
    headers: getUserAuthHeaders(event),
  });
  return data;
});
