import { getRequestHeader } from 'h3';

export default defineNuxtPlugin(async (nuxtApp) => {
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

        const response = await ssrAuthFetch(event, () =>
          $fetch<{ user?: any; session?: any }>(sessionUrl, {
            method: 'GET',
            headers,
          }).catch(() => null),
        );

        if (response?.user) {
          const impersonating = !!response.session?.impersonatedBy;
          store.$patch({
            isLoggedIn: true,
            userName: response.user.name ?? null,
            userEmail: response.user.email ?? null,
            currentSessionToken: response.session?.token ?? null,
            userInfo: { role: response.user.role ?? 'USER' },
            isImpersonating: impersonating,
            impersonatedUsername: impersonating ? (response.user.name ?? null) : null,
          });

          const prefsUrl = internalBackendUrl(config, '/v1/user/preferences');
          store.preferences = await $fetch<Record<string, any>>(prefsUrl, {
            method: 'GET',
            headers,
          }).catch(() => ({}));
        } else {
          store.resetAuthState();
        }
      } catch (error) {
        console.error('[SSR Auth] Error during session validation:', error);
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
});
