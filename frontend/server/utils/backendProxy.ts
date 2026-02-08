import type { H3Event } from 'h3';
import { getProxyRequestHeaders, getRequestURL, proxyRequest } from 'h3';

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function getBackendInternalBaseUrl(): string {
  const config = useRuntimeConfig();
  const baseUrl = String(config.backendInternalUrl || '').trim();

  if (!baseUrl) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Missing backend internal URL configuration',
    });
  }

  return normalizeBaseUrl(baseUrl);
}

function getTargetUrl(event: H3Event): string {
  const requestUrl = getRequestURL(event);
  return `${getBackendInternalBaseUrl()}${requestUrl.pathname}${requestUrl.search}`;
}

export function proxyToBackend(event: H3Event): Promise<any> {
  return proxyRequest(event, getTargetUrl(event), {
    headers: getProxyRequestHeaders(event, { host: false }),
  });
}
