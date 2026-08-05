import { createNadeshikoClient, type NadeshikoClient } from '@brigadasos/nadeshiko-sdk';

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
  const config = useRuntimeConfig();
  const baseURL = String(config.backendInternalUrl || '');
  const hostHeader = String(config.backendHostHeader || '');
  const apiKey = String(config.nadeshikoApiKey || '');

  const client = createNadeshikoClient({
    apiKey,
    baseURL,
  });

  if (hostHeader) {
    client.client.interceptors.request.use((request) => {
      request.headers.set('Host', hostHeader);
      return request;
    });
  }

  return client;
}

let clientSdk: NadeshikoClient | null = null;

/**
 * `'PROXY'` is an SDK environment constant that resolves to an empty base URL,
 * so requests stay same-origin (`/v1/...`) and land on the Nitro proxy, which
 * attaches credentials. It is absent from the SDK's `baseURL` union type and
 * only typechecks because that union widens to `string`.
 *
 * Note for anyone reaching for `'LOCAL'` instead: it resolves to
 * `http://localhost:5000/api`, and the backend serves no `/api` prefix. Both
 * fixes belong in the SDK repo, not here.
 */
function useClientSdk(): NadeshikoClient {
  if (!clientSdk) {
    clientSdk = createNadeshikoClient({ baseURL: 'PROXY' });
  }
  return clientSdk;
}
