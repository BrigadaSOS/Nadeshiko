import { getNadeshikoSdkClient, getUserAuthHeaders } from '~~/server/utils/nadeshikoSdk';

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const sdk = getNadeshikoSdkClient();
  const { data } = await sdk.userReportIndex({
    query: {
      size: query.size ? Number(query.size) : undefined,
      cursor: query.cursor ? Number(query.cursor) : undefined,
      status: query.status as any,
    },
    headers: getUserAuthHeaders(event),
  });
  return data;
});
