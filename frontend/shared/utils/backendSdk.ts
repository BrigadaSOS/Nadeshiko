import { createNadeshikoClient, type NadeshikoClient } from '@brigadasos/nadeshiko-sdk';

// Shared by SSR and Nitro without pulling server-only node dependencies into the client bundle.

export interface InternalSdkConfig {
  backendInternalUrl?: unknown;
  backendHostHeader?: unknown;
  nadeshikoApiKey?: unknown;
  internalProxySecret?: unknown;
}

export function normalizeBackendBaseUrl(raw: unknown): string {
  const baseUrl = String(raw ?? '').trim();

  if (!baseUrl) {
    throw new Error('NUXT_BACKEND_INTERNAL_URL is not set. Server-side requests have no backend to reach.');
  }

  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

// Structural type keeps shared code independent of server imports.
export interface PublicRoute {
  method: string;
  path: string;
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

// SSR and the proxy use the same allowlist before attaching service credentials.
export function createPublicRouteMatcher(routes: readonly PublicRoute[]) {
  const compiled = routes.map((route) => ({ method: route.method.toUpperCase(), matcher: toPathMatcher(route.path) }));

  return (method: string, pathname: string): boolean => {
    const normalized = method.toUpperCase();
    return compiled.some((route) => route.method === normalized && route.matcher.test(pathname));
  };
}

export interface InternalSdkOptions {
  // Missing allowlist fails closed: owner-scoped calls never receive the service key.
  publicRoutes?: readonly PublicRoute[];
  // Visitor cookie for owner-scoped SSR calls only. Omit for shared/cached responses to avoid leaking identity.
  cookie?: string;

  headers?: Record<string, string>;
}

// Choose credentials per route: service key for allowlisted corpus routes, visitor cookie otherwise.
// Bearer auth takes precedence over cookies, so never pass apiKey to createNadeshikoClient: it would authenticate
// owner-scoped requests as the service account before this interceptor can decide.
export function createInternalSdk(config: InternalSdkConfig, options: InternalSdkOptions = {}): NadeshikoClient {
  const baseURL = normalizeBackendBaseUrl(config.backendInternalUrl);
  const hostHeader = String(config.backendHostHeader ?? '');
  const apiKey = String(config.nadeshikoApiKey ?? '').trim();
  const internalProxySecret = String(config.internalProxySecret ?? '').trim();
  const cookie = options.cookie ?? '';
  const extraHeaders = Object.entries(options.headers ?? {});
  const isPublicRoute = createPublicRouteMatcher(options.publicRoutes ?? []);

  // Bound retries for SSR latency; one quick retry covers transient deploy failures. The SDK does not retry 429.
  // No client-wide apiKey: credentials are selected per route below.
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

    // The proxy secret exempts shared SSR source IPs without relying on a warm SERVICE-key auth cache.
    // It is not authentication and cannot replace either credential above.
    if (internalProxySecret) {
      request.headers.set('x-internal-proxy-auth', internalProxySecret);
    }

    // Carry the visitor's traffic classification; the service credential does not identify the visitor.
    for (const [name, value] of extraHeaders) {
      request.headers.set(name, value);
    }

    return request;
  });

  return client;
}
