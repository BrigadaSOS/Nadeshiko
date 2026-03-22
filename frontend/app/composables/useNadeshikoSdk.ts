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
  const baseUrl = String(config.backendInternalUrl || '');
  const hostHeader = String(config.backendHostHeader || '');
  const apiKey = String(config.nadeshikoApiKey || '');

  const client = createNadeshikoClient({
    apiKey,
    baseUrl,
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

function useClientSdk(): NadeshikoClient {
  if (!clientSdk) {
    clientSdk = createNadeshikoClient({ baseUrl: 'PROXY' });
  }
  return clientSdk;
}
