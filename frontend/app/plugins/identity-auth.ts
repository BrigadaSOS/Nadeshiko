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
          store.$patch({
            isLoggedIn: true,
            userName: response.user.name ?? null,
            userEmail: response.user.email ?? null,
            currentSessionToken: response.session?.token ?? null,
            userInfo: { role: response.user.role ?? 'USER' },
            preferences: response.user.preferences ?? {},
          });
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
  }
});
