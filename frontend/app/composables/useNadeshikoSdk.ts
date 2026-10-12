import { getRequestHeader } from 'h3';
import { createNadeshikoClient, type NadeshikoClient } from '@brigadasos/nadeshiko-sdk';
import { createInternalSdk } from '#shared/utils/backendSdk';
import { trafficHeaders } from '#shared/utils/traffic';
import { publicApiRoutes } from '~~/server/utils/generated/publicApiRoutes';

/**
 * SSR authenticates generated public routes with the service key and other routes with the
 * visitor's session cookie. Owner-scoped requests must omit the service key, not merely add a
 * cookie; see createInternalSdk.
 */
export function useNadeshikoSdk(): NadeshikoClient {
  if (import.meta.server) {
    return useSSRSdk();
  }
  return useClientSdk();
}

function useSSRSdk(): NadeshikoClient {
  const event = useRequestEvent();

  // The visitor's classification rides along, so the backend work this render
  // causes (Elasticsearch searches, most of all) is attributed to the crawler
  // that asked for it rather than to "a reader". `useRequestEvent` is a no-op
  // on the client; this branch only runs on the server anyway.
  return createInternalSdk(useRuntimeConfig(), {
    publicRoutes: publicApiRoutes,
    // Forwarded so an owner-scoped route can authenticate as the reader. It is
    // only ever attached to routes off the allowlist, so a public search still
    // goes out service-signed even for a signed-in visitor.
    cookie: event ? getRequestHeader(event, 'cookie') || '' : '',
    headers: trafficHeaders(event),
  });
}

let clientSdk: NadeshikoClient | null = null;

/**
 * PROXY keeps browser requests same-origin through Nitro, which attaches credentials. LOCAL
 * would bypass that proxy and target localhost.
 */
function useClientSdk(): NadeshikoClient {
  if (!clientSdk) {
    clientSdk = createNadeshikoClient({ baseURL: 'PROXY' });
  }
  return clientSdk;
}
