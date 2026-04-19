import { getRequestHeader } from 'h3';

export default defineNuxtPlugin(async (nuxtApp) => {
  const store = userStore();

  if (import.meta.server) {
    const event = nuxtApp.ssrContext?.event;

    if (event) {
      try {
        const cookieHeader = getRequestHeader(event, 'cookie');
        const config = useRuntimeConfig();
        const sessionUrl = `${config.backendInternalUrl}/v1/auth/get-session`;

        const headers: Record<string, string> = {
          cookie: cookieHeader || '',
        };
        if (config.backendHostHeader) {
          headers.host = String(config.backendHostHeader);
        }

        const response = await $fetch<{ user?: any; session?: any }>(sessionUrl, {
          method: 'GET',
          headers,
        }).catch(() => null);

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

          const prefsUrl = `${config.backendInternalUrl}/v1/user/preferences`;
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
