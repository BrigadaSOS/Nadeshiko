import { getNadeshikoSdkClient, getUserAuthHeaders } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const sdk = getNadeshikoSdkClient();
  const { data } = await sdk.userActivityStatsShow({
    query: {
      since: query.since ? String(query.since) : undefined,
    },
    headers: getUserAuthHeaders(event),
  } as any);
  return data;
});
