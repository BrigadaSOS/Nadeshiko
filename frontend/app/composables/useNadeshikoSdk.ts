import { createNadeshikoClient, type NadeshikoClient } from '@brigadasos/nadeshiko-sdk';

/**
 * Returns a configured NadeshikoClient that works on both SSR and client.
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

// ─── SSR ─────────────────────────────────────────────────────────────────────

let ssrApiKeyClient: NadeshikoClient | null = null;

function useSSRSdk(): NadeshikoClient {
  const event = useRequestEvent()!;
  const config = useRuntimeConfig();
  const baseUrl = String(config.backendInternalUrl || '');
  const hostHeader = String(config.backendHostHeader || '');
  const apiKey = String(config.nadeshikoApiKey || '');
  const sessionToken = getCookie(event, 'nadeshiko.session_token');

  // For authenticated users, create a per-request client with session cookie
  if (sessionToken) {
    const client = createNadeshikoClient({ sessionToken: () => sessionToken, baseUrl });
    if (hostHeader) {
      client.client.interceptors.request.use((request) => {
        request.headers.set('Host', hostHeader);
        return request;
      });
    }
    return client;
  }

  // For public endpoints (no session), use cached API key client
  if (!ssrApiKeyClient && apiKey) {
    ssrApiKeyClient = createNadeshikoClient({ apiKey, baseUrl });
    if (hostHeader) {
      ssrApiKeyClient.client.interceptors.request.use((request) => {
        request.headers.set('Host', hostHeader);
        return request;
      });
    }
  }

  if (ssrApiKeyClient) return ssrApiKeyClient;

  // Fallback: no API key, no session
  const fallback = createNadeshikoClient({ baseUrl });
  if (hostHeader) {
    fallback.client.interceptors.request.use((request) => {
      request.headers.set('Host', hostHeader);
      return request;
    });
  }
  return fallback;
}

// ─── Client ──────────────────────────────────────────────────────────────────

let clientSdk: NadeshikoClient | null = null;

function useClientSdk(): NadeshikoClient {
  if (!clientSdk) {
    clientSdk = createNadeshikoClient({ baseUrl: '' });
  }
  return clientSdk;
}
