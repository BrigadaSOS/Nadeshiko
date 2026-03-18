import { createNadeshikoClient, type NadeshikoClient } from '@brigadasos/nadeshiko-sdk';
import { getCookie } from 'h3';

/**
 * Returns a configured NadeshikoClient that works on both SSR and client.
 *
 * The SDK's auth callback automatically picks the right auth method per-endpoint:
 * - Bearer (API key) for public endpoints (search, listMedia, etc.)
 * - Cookie (session token) for user endpoints (preferences, collections, etc.)
 *
 * SSR: Uses the internal backend URL directly with forwarded cookies. No proxy hop.
 * Client: Uses empty base URL so SDK constructs /v1/... paths caught by the Nitro proxy.
 */
export function useNadeshikoSdk(): NadeshikoClient {
  if (import.meta.server) {
    return useSSRSdk();
  }
  return useClientSdk();
}

function useSSRSdk(): NadeshikoClient {
  const event = useRequestEvent();
  if (!event) throw new Error('useRequestEvent() returned undefined during SSR');
  const config = useRuntimeConfig();
  const baseUrl = String(config.backendInternalUrl || '');
  const hostHeader = String(config.backendHostHeader || '');
  const apiKey = String(config.nadeshikoApiKey || '');
  const sessionToken = getCookie(event, 'nadeshiko.session_token');

  const client = createNadeshikoClient({
    apiKey,
    sessionToken: () => sessionToken,
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
