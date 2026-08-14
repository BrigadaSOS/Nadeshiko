import { getRequestHeader } from 'h3';

/**
 * What the server managed to settle about the visitor's identity, so the client
 * knows whether asking again would tell it anything new.
 *
 * - `none` — the request carried no session cookie, so nothing was asked and the
 *   answer is not in doubt.
 * - `resolved` — the backend answered. Signed in or signed out, it is settled.
 * - `failed` — the backend could not be reached. Absent entirely (`undefined`)
 *   means there was no server pass at all. Only those two are worth a client-side
 *   round trip.
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
          const { hasSessionCookie, ssrAuthFetch } = await import('~~/server/utils/ssrAuthCache');

          // No cookie, no session: the backend has nothing to add, and asking it
          // anyway is a round trip on the critical path of most renders the site
          // serves -- every crawler, every share link, every cold first visit.
          if (!hasSessionCookie(event)) {
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

          // `$fetch` rather than the SDK, for two reasons that both still hold:
          // `/v1/auth/*` is mounted by better-auth and is not in the OpenAPI spec,
          // so the SDK has no method for it; and this call acts as the *reader*,
          // forwarding their cookie, while the SDK authenticates as the service.

          const { logger } = await import('~~/server/utils/logger');

          // Session AND preferences share one cache entry. Fetching preferences
          // outside it meant every render of every page made an uncached round
          // trip for a logged-in reader, which is most of what the cache exists
          // to avoid. Both now go stale together after the same 30s -- the
          // window the session was already accepting, and preference edits are
          // made client-side, where the store updates without a re-render.
          const identity = await ssrAuthFetch(event, async () => {
            let reachedBackend = true;

            const session = await $fetch<{ user?: any; session?: any }>(sessionUrl, {
              method: 'GET',
              headers,
              // ofetch retries GETs on 429 and 5xx by default, and both are
              // wrong for a call blocking a render. Retrying a 429 attacks our
              // own rate limiter: on 2026-08-09 that turned one throttled call
              // into three and held a Nitro worker while it waited. The
              // signed-out fallback below is cheaper than any retry.
              retry: false,
            }).catch((error: unknown) => {
              // Rendering signed-out is the right fallback -- the page still works
              // for a reader whose session we could not confirm. But an unreachable
              // backend looks identical to a signed-out visitor from here, so it is
              // logged: otherwise an auth outage shows up only as "everyone got
              // logged out", with nothing in the logs to say why. `reachedBackend`
              // carries that same distinction to the client, which retries on it.
              logger.warn({ err: error }, 'SSR session lookup failed; rendering as signed out');
              reachedBackend = false;
              return null;
            });

            if (!session?.user) return { session: null, preferences: {} as Record<string, any>, reachedBackend };

            const prefsUrl = internalBackendUrl(config, '/v1/user/preferences');
            const preferences = await $fetch<Record<string, any>>(prefsUrl, {
              method: 'GET',
              headers,
              // Same reasoning as the session call above; preferences are
              // additive and every one falls back to a default.
              retry: false,
            }).catch((error: unknown) => {
              // Preferences are additive -- every one falls back to a default -- so
              // the session stays usable without them.
              logger.warn({ err: error }, 'SSR preferences lookup failed; using defaults');
              return {} as Record<string, any>;
            });

            return { session, preferences, reachedBackend };
          });

          const response = identity.session;
          ssrCheck.value = identity.reachedBackend ? 'resolved' : 'failed';

          if (store.applySession(response)) {
            store.preferences = identity.preferences;
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
      const identify = () => {
        if (!store.isLoggedIn || !store.userName) return;
        const posthog = usePostHog();
        posthog?.identify(store.userName, { email: store.userEmail ?? undefined });
        posthog?.capture('$set', {
          $set: {
            content_rating: store.preferences?.contentRatingPreferences,
            media_name_language: store.preferences?.mediaNameLanguage,
            has_anki_configured: (store.preferences?.ankiProfiles?.length ?? 0) > 0,
            hidden_media_count: store.preferences?.hiddenMedia?.length ?? 0,
            hidden_categories: store.preferences?.hiddenCategories ?? [],
            default_search_category: store.preferences?.defaultSearchCategory ?? 'ALL',
          },
        });
      };

      // A signed-in reader arrives already populated: Pinia restores its state
      // from the payload in its own plugin, which runs before this one. What is
      // new is that a signed-OUT reader is now trusted too, instead of spending a
      // round trip re-deriving what the render already knew.
      //
      // Caveat worth knowing before HTML is shared-cached: `none` and `resolved`
      // are only as fresh as the HTML carrying them. A page replayed from the
      // browser cache after the reader signed in elsewhere would keep rendering
      // signed-out chrome, with nothing here to correct it. Today that window is
      // small -- responses carry no validator, so little reuses them for long --
      // but at the point pages are cached on purpose, this needs a session marker
      // the client can actually read. The session cookie itself is httpOnly.
      const settledOnServer = ssrCheck.value === 'none' || ssrCheck.value === 'resolved';

      if (!store.isLoggedIn && !settledOnServer) {
        // Deliberately not awaited: nothing in first paint depends on the answer,
        // and this branch is reached precisely when the backend has just failed to
        // answer the server -- the worst moment to hold hydration open for it.
        store.getBasicInfo().then(identify);
      } else {
        identify();
      }
    }
  },
});
