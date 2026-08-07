import { createNadeshikoClient, type NadeshikoClient } from '@brigadasos/nadeshiko-sdk';
import { createInternalSdk } from '#shared/utils/backendSdk';
import { trafficHeaders } from '#shared/utils/traffic';

/**
 * Returns a configured NadeshikoClient that works on both SSR and client.
 *
 * SSR: Uses Bearer auth (API key) only. Session-scoped endpoints are client-side only.
 * Client: Uses empty base URL so SDK constructs /v1/... paths caught by the Nitro proxy.
 */
export function useNadeshikoSdk(): NadeshikoClient {
  if (import.meta.server) {
    return useSSRSdk();
  }
  return useClientSdk();
}

function useSSRSdk(): NadeshikoClient {
  // The visitor's classification rides along, so the backend work this render
  // causes (Elasticsearch searches, most of all) is attributed to the crawler
  // that asked for it rather than to "a reader". `useRequestEvent` is a no-op
  // on the client; this branch only runs on the server anyway.
  return createInternalSdk(useRuntimeConfig(), trafficHeaders(useRequestEvent()));
}

let clientSdk: NadeshikoClient | null = null;

/**
 * `'PROXY'` is an SDK environment constant that resolves to an empty base URL,
 * so requests stay same-origin (`/v1/...`) and land on the Nitro proxy, which
 * attaches credentials. Reaching for `'LOCAL'` instead would point the browser
 * straight at the backend on localhost, bypassing the proxy and its credentials.
 */
function useClientSdk(): NadeshikoClient {
  if (!clientSdk) {
    clientSdk = createNadeshikoClient({ baseURL: 'PROXY' });
  }
  return clientSdk;
}
