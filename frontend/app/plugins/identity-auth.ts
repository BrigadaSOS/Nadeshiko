import { getRequestHeader } from 'h3';

export default defineNuxtPlugin({
  // Named so `auth-callback` can declare it as a dependency: that plugin reads
  // the session this one bootstraps.
  name: 'identity-auth',
  async setup(nuxtApp) {
    const store = userStore();

    if (import.meta.server) {
      const event = nuxtApp.ssrContext?.event;

      if (event) {
        try {
          // Dynamic import keeps these server-only utils (and their node:crypto
          // dependency) out of the client bundle.
          const { ssrAuthFetch } = await import('~~/server/utils/ssrAuthCache');
          const { buildInternalBackendHeaders, internalBackendUrl } = await import('~~/server/utils/internalBackend');
          const cookieHeader = getRequestHeader(event, 'cookie');
          const config = useRuntimeConfig();
          const sessionUrl = internalBackendUrl(config, '/v1/auth/get-session');

          // Same headers the /v1 Nitro proxy sends: the internal-proxy secret
          // keeps these SSR calls out of the backend's per-IP bucket, which every
          // render would otherwise share (they all come from this host's IP).
          const headers = buildInternalBackendHeaders(config, { cookie: cookieHeader || '' });

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
            const session = await $fetch<{ user?: any; session?: any }>(sessionUrl, {
              method: 'GET',
              headers,
            }).catch((error: unknown) => {
              // Rendering signed-out is the right fallback -- the page still works
              // for a reader whose session we could not confirm. But an unreachable
              // backend looks identical to a signed-out visitor from here, so it is
              // logged: otherwise an auth outage shows up only as "everyone got
              // logged out", with nothing in the logs to say why.
              logger.warn({ err: error }, 'SSR session lookup failed; rendering as signed out');
              return null;
            });

            if (!session?.user) return { session: null, preferences: {} as Record<string, any> };

            const prefsUrl = internalBackendUrl(config, '/v1/user/preferences');
            const preferences = await $fetch<Record<string, any>>(prefsUrl, {
              method: 'GET',
              headers,
            }).catch((error: unknown) => {
              // Preferences are additive -- every one falls back to a default -- so
              // the session stays usable without them.
              logger.warn({ err: error }, 'SSR preferences lookup failed; using defaults');
              return {} as Record<string, any>;
            });

            return { session, preferences };
          });

          const response = identity.session;

          if (store.applySession(response)) {
            store.preferences = identity.preferences;
          }
        } catch (error) {
          const { logger } = await import('~~/server/utils/logger');
          logger.error({ err: error }, 'SSR auth bootstrap failed; rendering as signed out');
          store.resetAuthState();
        }
      }
    }

    if (import.meta.client) {
      if (!store.isLoggedIn) {
        await store.getBasicInfo();
      }
      if (store.isLoggedIn && store.userName) {
        const posthog = usePostHog();
        posthog?.identify(store.userName, { email: store.userEmail ?? undefined });
        posthog?.capture('$set', {
          $set: {
            content_rating: store.preferences?.contentRatingPreferences,
            media_name_language: store.preferences?.mediaNameLanguage,
            has_anki_configured: (store.preferences?.ankiProfiles?.length ?? 0) > 0,
            hidden_media_count: store.preferences?.hiddenMedia?.length ?? 0,
          },
        });
      }
    }
  },
});
