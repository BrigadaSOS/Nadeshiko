import type { H3Event } from 'h3';
import { getProxyRequestHeaders, getRequestURL, proxyRequest, setCookie } from 'h3';
import { buildInternalBackendHeaders, internalBackendUrl } from '~~/server/utils/internalBackend';
import { publicApiRoutes } from '~~/server/utils/generated/publicApiRoutes';
import { dropSessionEntries, PREFS_VERSION_COOKIE, PREFS_VERSION_MAX_AGE_S } from '~~/server/utils/ssrAuthCache';
import { createPublicRouteMatcher } from '#shared/utils/backendSdk';

/**
 * Routes whose writes rewrite the user's preferences column.
 *
 * Favourites and hidden media are not their own tables -- they are fields in
 * that one JSON column, which is also what the SSR identity cache stores
 * alongside the session. So a write here invalidates a render's worth of cached
 * identity, and nothing else does.
 *
 * Deliberately NOT the whole of `/v1/user/**`. `POST /v1/user/activity` fires on
 * arrival at every single search, and treating that as a preferences write would
 * bust the cache constantly -- which is the cost the cache exists to avoid.
 */
const PREFERENCE_WRITE_PATHS = [
  /^\/v1\/user\/preferences\/?$/,
  /^\/v1\/user\/excluded-media(?:\/|$)/,
  /^\/v1\/user\/favorite-media(?:\/|$)/,
  // Not a preferences column, but the same cached identity: `get-session`
  // folds `user.shirabe` (linked, stack fingerprint) into what this cache
  // stores, and linking (`POST .../callback`) or unlinking (`DELETE`) moves it.
  // Left out, a reader who had just linked got the default dictionaries for a
  // minute -- their first lookups being the ones they linked to change.
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

  const stampsPreferences = writesPreferences(method, requestUrl.pathname);

  return proxyRequest(event, getTargetUrl(event), {
    headers,
    fetchOptions: {
      redirect: 'manual',
    },
    // Inside `onResponse`, not before the call, and the ordering is load-bearing
    // twice over. `sendProxy` installs the backend's own `Set-Cookie` with
    // `setHeader` -- a replace, not an append -- so a cookie written before this
    // point is dropped the moment the backend sets one of its own. `onResponse`
    // runs after that assignment and before the body is streamed, and h3's
    // `setCookie` folds the new cookie in beside whatever is already there.
    // Being here also means the status is known, so only a write that actually
    // took invalidates anything.
    onResponse: (proxyEvent, response) => {
      stripCrossOriginHeaders(proxyEvent);

      if (!stampsPreferences) return;
      if (response.status < 200 || response.status >= 300) return;
      // Two halves of one invalidation. The stamp reaches every worker but
      // only this browser; the drop reaches every browser but only this
      // worker. Neither covers the other's case, and together they leave
      // only a caller on a fresh cookie jar hitting a *different* worker.
      stampPreferencesVersion(proxyEvent, requestUrl.protocol === 'https:');
      dropSessionEntries(proxyEvent);
    },
  });
}

/**
 * Marks this browser's requests as carrying preferences newer than anything the
 * SSR identity cache holds. Exported for the test that guards the append.
 */
export function stampPreferencesVersion(event: H3Event, secure: boolean): void {
  setCookie(event, PREFS_VERSION_COOKIE, String(Date.now()), {
    path: '/',
    maxAge: PREFS_VERSION_MAX_AGE_S,
    httpOnly: true,
    sameSite: 'lax',
    secure,
  });
}

/**
 * Drops the backend's CORS headers from anything this proxy returns.
 *
 * The backend opens the public corpus routes to `*` on purpose, for third-party
 * clients calling `api.nadeshiko.co` with a key of their own. THIS path is not
 * that: it is the site's own same-origin `/v1`, and it injects the MASTER key on
 * exactly the routes the backend marks public (see `shouldInjectApiKey`).
 *
 * Forwarding the headers therefore handed every website on the internet a
 * keyless copy of the API: `fetch('https://nadeshiko.co/v1/search')` from any
 * page answered 200 with real data, signed by the service account, attributed to
 * our quota rather than the caller's, and bypassing the bring-your-own-key
 * scheme entirely. Measured before this existed -- 200, `access-control-allow-
 * origin: *`, no credentials of any kind required.
 *
 * Same-origin callers -- the only ones this proxy is for -- need none of these
 * headers, so removing them costs the site nothing and puts the browser back in
 * front of the door.
 */
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
