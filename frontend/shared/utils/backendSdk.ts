import { createNadeshikoClient, type NadeshikoClient } from '@brigadasos/nadeshiko-sdk';

/**
 * Building the SDK that talks to the backend over the internal network.
 *
 * Server-side rendering and the Nitro endpoints both need this, and they used to
 * each build it themselves. The copies drifted: one stripped a trailing slash
 * from the base URL and the other did not, so the same configuration produced
 * `http://backend:3000//v1/...` down one path and `.../v1/...` down the other.
 * Both also fell back to an empty base URL when the config was missing, turning a
 * misconfiguration into a confusing "failed to parse URL" at the first request
 * rather than a clear error at startup.
 *
 * This lives in `shared/` so app and server code can both import it without the
 * server-only helpers (and their node: dependencies) reaching the client bundle.
 */

export interface InternalSdkConfig {
  backendInternalUrl?: unknown;
  backendHostHeader?: unknown;
  nadeshikoApiKey?: unknown;
  internalProxySecret?: unknown;
}

/** Trims and drops a trailing slash, so joining `${base}${path}` never doubles it. */
export function normalizeBackendBaseUrl(raw: unknown): string {
  const baseUrl = String(raw ?? '').trim();

  if (!baseUrl) {
    throw new Error('NUXT_BACKEND_INTERNAL_URL is not set. Server-side requests have no backend to reach.');
  }

  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

/** One entry of the generated allowlist; structural so `shared/` need not import from `server/`. */
export interface PublicRoute {
  method: string;
  path: string;
}

/** Turns an OpenAPI path template (`/v1/media/{id}`) into a matcher for a real path. */
function toPathMatcher(openApiPath: string): RegExp {
  const pattern = openApiPath
    .split('/')
    .map((segment) =>
      segment.startsWith('{') && segment.endsWith('}') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('/');
  return new RegExp(`^${pattern}$`);
}

/**
 * Builds the "may this route be called with the service key?" test from the
 * generated allowlist.
 *
 * Shared with the Nitro proxy rather than reimplemented there: the proxy and the
 * SSR SDK are the only two things that hold the master key, and they were
 * answering this question with two copies of the same regex -- except the SSR
 * side never asked it at all, which is how a server render came to read private
 * collections as an admin. One implementation, one answer, both callers.
 */
export function createPublicRouteMatcher(routes: readonly PublicRoute[]) {
  const compiled = routes.map((route) => ({ method: route.method.toUpperCase(), matcher: toPathMatcher(route.path) }));

  return (method: string, pathname: string): boolean => {
    const normalized = method.toUpperCase();
    return compiled.some((route) => route.method === normalized && route.matcher.test(pathname));
  };
}

export interface InternalSdkOptions {
  /**
   * The generated public-route allowlist. Absent means "no route is public",
   * which is the safe default: the key is then never attached and an
   * owner-scoped call fails with 401 instead of succeeding as the service.
   */
  publicRoutes?: readonly PublicRoute[];
  /**
   * The visitor's `Cookie` header, for owner-scoped calls made during SSR.
   *
   * Omit it for anything whose response is shared or cached -- the Nitro API
   * routes, the sitemaps. A cookie-authenticated response stored in an `swr`
   * cache would be served to the next visitor.
   */
  cookie?: string;
  /** Traffic classification and anything else that rides along on every call. */
  headers?: Record<string, string>;
}

/**
 * An SDK client pointed at the internal backend, choosing its credential per route.
 *
 * The credential follows the ROUTE, not the call site. That is the whole point of
 * this function's shape. It used to attach `API_KEY_MASTER` to everything, which
 * is right for the public corpus -- anonymous browsing shares one service
 * identity, keeping it out of the per-account quota -- and a privilege escalation
 * anywhere else: the master key belongs to an account seeded with `role: ADMIN`,
 * so a server render asking for a private collection was handed it and served it
 * to whoever asked. The `/v1` Nitro proxy never had that bug because it consults
 * the generated allowlist first; the SSR path simply never asked the question.
 *
 * Now both ask it, through the same matcher:
 *
 *   - route in the allowlist  → `Authorization: Bearer <master key>`
 *   - anything else           → the visitor's cookie, and no bearer token
 *
 * The key must be ABSENT rather than merely accompanied by a cookie. The backend's
 * `requireAuth` branches on `hasBearer` first and only falls through to the
 * session when there is no `Authorization` header, so a request carrying both
 * still authenticates as the service. That is why the key is set here, in the
 * interceptor, instead of being handed to `createNadeshikoClient` -- passing it as
 * `apiKey` would stamp it on every request before this code could decide.
 *
 * With no `publicRoutes` and no `cookie` the client is simply unauthenticated,
 * which fails closed: 401 rather than someone else's data.
 *
 * `backendHostHeader` exists for deployments where the backend routes by Host and
 * the internal URL is an address rather than the public hostname.
 */
export function createInternalSdk(config: InternalSdkConfig, options: InternalSdkOptions = {}): NadeshikoClient {
  const baseURL = normalizeBackendBaseUrl(config.backendInternalUrl);
  const hostHeader = String(config.backendHostHeader ?? '');
  const apiKey = String(config.nadeshikoApiKey ?? '').trim();
  const internalProxySecret = String(config.internalProxySecret ?? '').trim();
  const cookie = options.cookie ?? '';
  const extraHeaders = Object.entries(options.headers ?? {});
  const isPublicRoute = createPublicRouteMatcher(options.publicRoutes ?? []);

  // A retry budget sized for a request someone is waiting on. The default (2
  // retries, backoff capped at 30s) is built for a background job that can
  // afford to wait; here every millisecond is spent inside a server-side render
  // holding a Nitro worker, and there are only NITRO_CLUSTER_WORKERS of those.
  // A backend that is briefly unwell should produce slightly degraded pages,
  // not a queue of workers asleep in backoff -- which is what turned a rate
  // limit into 12s response times and abandoned loads on 2026-08-09.
  //
  // One quick retry still absorbs the genuinely transient case (a container
  // being replaced mid-deploy). 429 is not retried at any level -- see
  // RETRYABLE_STATUS in the SDK's retry.ts.
  //
  // Deliberately no `apiKey` here; see the note above on why the credential is
  // decided in the interceptor instead.
  const client = createNadeshikoClient({
    baseURL,
    retryOptions: { maxRetries: 1, initialDelayMs: 100, maxDelayMs: 500 },
  });

  client.client.interceptors.request.use((request) => {
    if (hostHeader) {
      request.headers.set('Host', hostHeader);
    }

    const pathname = new URL(request.url).pathname;
    if (apiKey && isPublicRoute(request.method, pathname)) {
      request.headers.set('authorization', `Bearer ${apiKey}`);
    } else if (cookie) {
      request.headers.set('cookie', cookie);
    }

    // The same shared secret the `/v1/*` Nitro proxy and the SSR session call
    // send (see server/utils/internalBackend.ts). Without it these calls are not
    // recognised as ours, and the backend's per-IP limiter buckets every render
    // this host performs against one key -- 300/min for the entire site.
    //
    // The service API key is NOT a substitute. The backend does exempt SERVICE
    // keys, but only by resolving the bearer token against its auth cache, and
    // the limiter is mounted before the router: a request that is refused never
    // reaches auth, so it never repopulates the cache that would have exempted
    // it. Once that cache goes cold under load the exemption cannot re-arm
    // itself, which is how a traffic spike turns into sustained 429s on our own
    // server-side renders. The secret needs no lookup and cannot fall cold.
    //
    // It is not an authentication signal: `lib/internalProxy.ts` never sets
    // `req.auth`, so it cannot stand in for either credential above.
    if (internalProxySecret) {
      request.headers.set('x-internal-proxy-auth', internalProxySecret);
    }

    // How the visitor's reader/bot/monitor classification reaches the backend.
    // Without it, the searches an SSR render runs on a crawler's behalf arrive
    // there as anonymous load -- the request carries the service API key, not the
    // crawler's User-Agent -- and the backend's traffic split would say almost
    // every request came from a reader.
    for (const [name, value] of extraHeaders) {
      request.headers.set(name, value);
    }

    return request;
  });

  return client;
}
