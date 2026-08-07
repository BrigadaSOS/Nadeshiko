import type { H3Event } from 'h3';
import { getProxyRequestHeaders, getRequestURL, proxyRequest } from 'h3';
import { buildInternalBackendHeaders, internalBackendUrl } from '~~/server/utils/internalBackend';
import { publicApiRoutes } from '~~/server/utils/generated/publicApiRoutes';

function getTargetUrl(event: H3Event): string {
  const requestUrl = getRequestURL(event);
  return internalBackendUrl(useRuntimeConfig(), `${requestUrl.pathname}${requestUrl.search}`);
}

function toPathMatcher(openApiPath: string): RegExp {
  const pattern = openApiPath
    .split('/')
    .map((segment) =>
      segment.startsWith('{') && segment.endsWith('}') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('/');
  return new RegExp(`^${pattern}$`);
}

const publicRouteMatchers = publicApiRoutes.map((route) => ({
  method: route.method,
  matcher: toPathMatcher(route.path),
}));

export function shouldInjectApiKey(method: string, pathname: string): boolean {
  const normalizedMethod = method.toUpperCase();
  return publicRouteMatchers.some((route) => route.method === normalizedMethod && route.matcher.test(pathname));
}

export function proxyToBackend(event: H3Event): Promise<any> {
  const config = useRuntimeConfig();
  const headers = buildInternalBackendHeaders(config, getProxyRequestHeaders(event, { host: false }), event);
  const requestUrl = getRequestURL(event);
  const method = event.node.req.method || 'GET';

  // The master key is the backend's SERVICE identity, not the visitor's, so it
  // is only ever attached to routes the generated allowlist marks as reading
  // the shared corpus. Injecting it on an owner-scoped route would answer with
  // the service account's own data. Regenerate the allowlist from the OpenAPI
  // spec with `npm run generate:api` in ../backend.
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
