import { getRequestHeader } from 'h3';
import { createNadeshikoClient, type NadeshikoClient } from '@brigadasos/nadeshiko-sdk';
import { createInternalSdk } from '#shared/utils/backendSdk';
import { trafficHeaders } from '#shared/utils/traffic';
import { publicApiRoutes } from '~~/server/utils/generated/publicApiRoutes';

/**
 * The SDK, on either side of the render.
 *
 * There used to be a second composable for owner-scoped SSR calls, and choosing
 * between them was left to whoever wrote the call site — with the unsafe one as
 * the default. That is how a server render came to read private collections as
 * an admin. The choice now belongs to the route, not the caller, so there is one
 * composable again and it is correct wherever it is used:
 *
 *   - a route on the generated public allowlist → the service key, as before,
 *     which is what keeps anonymous browsing out of the per-account quota
 *   - anything else → the visitor's own session cookie, forwarded from the
 *     request being rendered
 *
 * See `createInternalSdk` for why the key has to be absent rather than merely
 * accompanied on that second path.
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
