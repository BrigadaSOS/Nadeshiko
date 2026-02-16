import { getNadeshikoSdkClient, getUserAuthHeaders } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const sdk = getNadeshikoSdkClient();
  const limit = query.limit ? Number(query.limit) : query.size ? Number(query.size) : undefined;
  const { data } = await sdk.userActivityIndex({
    query: {
      limit,
      cursor: query.cursor ? Number(query.cursor) : undefined,
      activityType: query.activityType as any,
      date: query.date ? String(query.date) : undefined,
    } as any,
    headers: getUserAuthHeaders(event),
  });
  return data;
});
