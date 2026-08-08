import type { H3Event } from 'h3';
import { getProxyRequestHeaders, getRequestURL, proxyRequest } from 'h3';
import { buildInternalBackendHeaders, internalBackendUrl } from '~~/server/utils/internalBackend';
import { publicApiRoutes } from '~~/server/utils/generated/publicApiRoutes';
import { createPublicRouteMatcher } from '#shared/utils/backendSdk';

function getTargetUrl(event: H3Event): string {
  const requestUrl = getRequestURL(event);
  return internalBackendUrl(useRuntimeConfig(), `${requestUrl.pathname}${requestUrl.search}`);
}

/**
 * Shared with the SSR SDK rather than kept as a second copy of the same regex.
 * The proxy always asked this question; the SSR path did not, and that gap is
 * what let a server render read private collections with the master key. One
 * implementation now answers for both.
 */
export const shouldInjectApiKey = createPublicRouteMatcher(publicApiRoutes);

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
