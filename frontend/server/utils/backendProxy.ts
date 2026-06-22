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

function shouldInjectApiKey(method: string, pathname: string): boolean {
  const normalizedMethod = method.toUpperCase();

  // Public read endpoints under /v1/media and /v1/stats.
  if (normalizedMethod === 'GET' && (pathname.startsWith('/v1/media') || pathname.startsWith('/v1/stats'))) {
    return true;
  }

  // Public search endpoints are POST-only.
  if (
    normalizedMethod === 'POST' &&
    (pathname === '/v1/search' || pathname === '/v1/search/stats' || pathname === '/v1/search/words')
  ) {
    return true;
  }

  return false;
}

export function proxyToBackend(event: H3Event): Promise<any> {
  const config = useRuntimeConfig();
  const headers = getProxyRequestHeaders(event, { host: false });
  const requestUrl = getRequestURL(event);
  const method = event.node.req.method || 'GET';

  if (config.backendHostHeader) {
    headers.host = config.backendHostHeader;
  }

  // Mark this request as coming through our trusted proxy so the backend per-IP
  // rate limiter can exempt it. Always overwrite (and otherwise strip) the
  // header so a client can never forge it by sending it themselves.
  delete headers['x-internal-proxy-auth'];
  const internalProxySecret = String(config.internalProxySecret || '').trim();
  if (internalProxySecret) {
    headers['x-internal-proxy-auth'] = internalProxySecret;
  }

  // Inject API key only for explicit public endpoint allowlist.
  const apiKey = String(config.nadeshikoApiKey || '').trim();
  if (apiKey && !headers.authorization && shouldInjectApiKey(method, requestUrl.pathname)) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  return proxyRequest(event, getTargetUrl(event), {
    headers,
    fetchOptions: {
      redirect: 'manual',
    },
  });
}
