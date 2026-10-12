import { getRequestHeader } from 'h3';

/**
 * SSR identity outcome: `none` means no cookie; `resolved` means the backend answered. Only `failed` or an
 * absent server marker warrants another client fetch.
 */
export type SsrIdentityCheck = 'none' | 'resolved' | 'failed';

export const SSR_IDENTITY_CHECK_KEY = 'nd-ssr-identity-check';

export default defineNuxtPlugin({
  // Named so `auth-callback` can declare it as a dependency: that plugin reads
  // the session this one bootstraps.
  name: 'identity-auth',
  async setup(nuxtApp) {
    const store = userStore();
    // Serialized into the payload, which is how the client branch below learns
    // what the server already established.
    const ssrCheck = useState<SsrIdentityCheck | undefined>(SSR_IDENTITY_CHECK_KEY, () => undefined);

    if (import.meta.server) {
      const event = nuxtApp.ssrContext?.event;

      if (event) {
        try {
          // Dynamic import keeps these server-only utils (and their node:crypto
          // dependency) out of the client bundle.
          const { hasSessionCookie, recordAnonymousRender, ssrAuthFetch } = await import(
            '~~/server/utils/ssrAuthCache'
          );

          // No cookie, no session: the backend has nothing to add, and asking it
          // anyway is a round trip on the critical path of most renders the site
          // serves -- every crawler, every share link, every cold first visit.
          if (!hasSessionCookie(event)) {
            // Count anonymous renders separately from authenticated cache hits for the SSR denominator.
            recordAnonymousRender();
            ssrCheck.value = 'none';
            return;
          }

          const { buildInternalBackendHeaders, internalBackendUrl } = await import('~~/server/utils/internalBackend');
          const cookieHeader = getRequestHeader(event, 'cookie');
          const config = useRuntimeConfig();
          const sessionUrl = internalBackendUrl(config, '/v1/auth/get-session');

          // Same headers the /v1 Nitro proxy sends: the internal-proxy secret
          // keeps these SSR calls out of the backend's per-IP bucket, which every
          // render would otherwise share (they all come from this host's IP).
          const headers = buildInternalBackendHeaders(config, { cookie: cookieHeader || '' }, event);

          // Use fetch with the reader's cookie: better-auth routes are outside the SDK spec, and service
          // authentication would ask about the wrong identity.

          const { logger } = await import('~~/server/utils/logger');
          const { applyRenewedSessionCookies, renewedSessionCookies } = await import(
            '~~/server/utils/sessionCookieRenewal'
          );

          // Fetch session and embedded preferences together. Both share the SSR auth cache and
          // `nd-prefs-version` invalidation; a separate preferences request adds latency without improving
          // freshness.
          const identity = await ssrAuthFetch(event, async () => {
            let reachedBackend = true;

            // Use `.raw` to forward renewed Set-Cookie headers; otherwise backend sliding renewal never
            // reaches the browser.
            const sessionResponse = await $fetch
              .raw<{ user?: any; session?: any }>(sessionUrl, {
                method: 'GET',
                headers,
                // Do not retry a render-blocking request on 429/5xx; use the signed-out fallback instead of
                // amplifying throttling.
                retry: false,
              })
              .catch((error: unknown) => {
                // Render signed-out on backend failure, but log and mark it as unresolved so the client can
                // retry rather than treating it as confirmed logout.
                logger.warn({ err: error }, 'SSR session lookup failed; rendering as signed out');
                reachedBackend = false;
                return null;
              });

            const session = sessionResponse?._data ?? null;
            // Cache renewal headers beside the session, then emit them outside this callback so cache-hit
            // renders renew cookies too.
            const renewedCookies = renewedSessionCookies(sessionResponse?.headers);

            return { session: session?.user ? session : null, reachedBackend, renewedCookies };
          });

          applyRenewedSessionCookies(event, identity.renewedCookies);

          const response = identity.session;
          ssrCheck.value = identity.reachedBackend ? 'resolved' : 'failed';

          if (store.applySession(response)) {
            // Off the session user, where the backend now puts it. `applySession`
            // picks the fields it wants by name and does not carry this one, so
            // reading it here is what keeps the store's contract unchanged --
            // and the blob is not stored twice in the hydration payload.
            store.preferences = response?.user?.preferences ?? {};
          }
        } catch (error) {
          const { logger } = await import('~~/server/utils/logger');
          logger.error({ err: error }, 'SSR auth bootstrap failed; rendering as signed out');
          ssrCheck.value = 'failed';
          store.resetAuthState();
        }
      }
    }

    if (import.meta.client) {
      // Not just an identify: this is also where a signup or a login is noticed,
      // by comparing the account in session against the last one this browser
      // reported. `auth-callback` calls it again on an auth landing to catch the
      // case that comparison cannot see -- the same reader signing back in.
      const identify = () => reconcileAnalyticsIdentity({ viaCallback: false });

      // Trust settled SSR identity restored by Pinia. This is only as fresh as its HTML: deliberately caching
      // pages would require a client-readable session marker, since the session cookie is httpOnly.
      const settledOnServer = ssrCheck.value === 'none' || ssrCheck.value === 'resolved';

      if (!store.isLoggedIn && !settledOnServer) {
        // Do not block hydration on a retry after the backend just failed during SSR.
        store.getBasicInfo().then(identify);
      } else {
        identify();
      }
    }
  },
});
