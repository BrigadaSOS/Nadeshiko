import { getUserAuthHeaders } from '~~/server/utils/nadeshikoSdk';

type HeatmapResponse = { counts: Record<string, number> };

export default defineEventHandler(async (event): Promise<HeatmapResponse> => {
  const query = getQuery(event);
  const config = useRuntimeConfig();
  const baseUrl = String(config.backendInternalUrl || '');
  const headers = getUserAuthHeaders(event);
  const hostHeader = String(config.backendHostHeader || '');

  const data: HeatmapResponse = await $fetch('/v1/user/activity/heatmap', {
    baseURL: baseUrl,
    headers: {
      ...headers,
      ...(hostHeader ? { Host: hostHeader } : {}),
    },
    params: {
      days: query.days ? Number(query.days) : undefined,
      activityType: query.activityType || undefined,
    },
  });
  return data;
});
