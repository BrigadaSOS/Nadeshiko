import type { H3Event } from 'h3';
import { getProxyRequestHeaders, getRequestURL, proxyRequest, setCookie } from 'h3';
import { buildInternalBackendHeaders, internalBackendUrl } from '~~/server/utils/internalBackend';
import { publicApiRoutes } from '~~/server/utils/generated/publicApiRoutes';
import { dropSessionEntries, PREFS_VERSION_COOKIE, PREFS_VERSION_MAX_AGE_S } from '~~/server/utils/ssrAuthCache';
import { createPublicRouteMatcher } from '#shared/utils/backendSdk';

// Invalidate cached identity for preference writes, not ordinary activity writes.
const PREFERENCE_WRITE_PATHS = [
  /^\/v1\/user\/preferences\/?$/,
  /^\/v1\/user\/excluded-media(?:\/|$)/,
  /^\/v1\/user\/favorite-media(?:\/|$)/,
  // Shirabe linking also changes the identity cached by get-session.
  /^\/v1\/user\/connections\/shirabe(?:\/callback)?\/?$/,
];

export function writesPreferences(method: string, pathname: string): boolean {
  const verb = method.toUpperCase();
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return false;
  return PREFERENCE_WRITE_PATHS.some((route) => route.test(pathname));
}

function getTargetUrl(event: H3Event): string {
  const requestUrl = getRequestURL(event);
  return internalBackendUrl(useRuntimeConfig(), `${requestUrl.pathname}${requestUrl.search}`);
}

// Share the public-route matcher with SSR so neither path uses the service key for private data.
export const shouldInjectApiKey = createPublicRouteMatcher(publicApiRoutes);

export function proxyToBackend(event: H3Event): Promise<any> {
  const config = useRuntimeConfig();
  const headers = buildInternalBackendHeaders(config, getProxyRequestHeaders(event, { host: false }), event);
  const requestUrl = getRequestURL(event);
  const method = event.node.req.method || 'GET';

  // The SERVICE key may only read allowlisted corpus routes, never owner-scoped data.
  const apiKey = String(config.nadeshikoApiKey || '').trim();
  if (apiKey && !headers.authorization && shouldInjectApiKey(method, requestUrl.pathname)) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const stampsPreferences = writesPreferences(method, requestUrl.pathname);

  return proxyRequest(event, getTargetUrl(event), {
    headers,
    fetchOptions: {
      redirect: 'manual',
    },
    // Run after h3 installs backend Set-Cookie headers so the stamp is appended, not overwritten.
    // Only successful writes invalidate cached identity.
    onResponse: (proxyEvent, response) => {
      stripCrossOriginHeaders(proxyEvent);

      if (!stampsPreferences) return;
      if (response.status < 200 || response.status >= 300) return;
      // The stamp follows this browser across processes; dropping entries covers other browsers in this process.
      stampPreferencesVersion(proxyEvent, requestUrl.protocol === 'https:');
      dropSessionEntries(proxyEvent);
    },
  });
}

export function stampPreferencesVersion(event: H3Event, secure: boolean): void {
  setCookie(event, PREFS_VERSION_COOKIE, String(Date.now()), {
    path: '/',
    maxAge: PREFS_VERSION_MAX_AGE_S,
    httpOnly: true,
    sameSite: 'lax',
    secure,
  });
}

// This same-origin proxy injects the service key; public API CORS headers would expose a keyless API to other websites.
export function stripCrossOriginHeaders(event: H3Event): void {
  for (const header of [
    'access-control-allow-origin',
    'access-control-allow-methods',
    'access-control-allow-headers',
    'access-control-allow-credentials',
    'access-control-expose-headers',
    'access-control-max-age',
  ]) {
    event.node.res.removeHeader(header);
  }
}
