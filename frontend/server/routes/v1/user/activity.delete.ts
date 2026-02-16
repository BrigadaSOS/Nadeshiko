import { getNadeshikoSdkClient, getUserAuthHeaders } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const sdk = getNadeshikoSdkClient();
  const { data } = await sdk.userActivityDestroy({
    query: {
      activityType: query.activityType as any,
    },
    headers: getUserAuthHeaders(event),
  });
  return data;
});
