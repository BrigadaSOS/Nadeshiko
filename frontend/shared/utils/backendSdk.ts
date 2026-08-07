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
}

/** Trims and drops a trailing slash, so joining `${base}${path}` never doubles it. */
export function normalizeBackendBaseUrl(raw: unknown): string {
  const baseUrl = String(raw ?? '').trim();

  if (!baseUrl) {
    throw new Error(
      'NUXT_BACKEND_INTERNAL_URL is not set. Server-side requests have no backend to reach.',
    );
  }

  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

/**
 * An SDK client pointed at the internal backend, carrying the service API key.
 *
 * `backendHostHeader` exists for deployments where the backend routes by Host and
 * the internal URL is an address rather than the public hostname.
 */
export function createInternalSdk(
  config: InternalSdkConfig,
  extraHeaders: Record<string, string> = {},
): NadeshikoClient {
  const baseURL = normalizeBackendBaseUrl(config.backendInternalUrl);
  const hostHeader = String(config.backendHostHeader ?? '');
  const apiKey = String(config.nadeshikoApiKey ?? '');

  const client = createNadeshikoClient({ apiKey, baseURL });

  if (hostHeader) {
    client.client.interceptors.request.use((request) => {
      request.headers.set('Host', hostHeader);
      return request;
    });
  }

  // `extraHeaders` is how the visitor's reader/bot/monitor classification
  // reaches the backend. Without it, the searches an SSR render runs on a
  // crawler's behalf arrive there as anonymous load — the request carries the
  // service API key, not the crawler's User-Agent — and the backend's traffic
  // split would say almost every request came from a reader.
  const headerEntries = Object.entries(extraHeaders);
  if (headerEntries.length > 0) {
    client.client.interceptors.request.use((request) => {
      for (const [name, value] of headerEntries) {
        request.headers.set(name, value);
      }
      return request;
    });
  }

  return client;
}
