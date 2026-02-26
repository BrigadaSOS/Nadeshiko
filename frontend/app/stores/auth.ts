import { useNuxtApp } from '#app';
import { defineStore } from 'pinia';

type UserRole = 'ADMIN' | 'MOD' | 'USER' | 'PATREON';

export type UserSession = {
  token: string;
  expiresAt?: string;
  createdAt?: string;
  updatedAt?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

function defaultAuthState() {
  return {
    isLoggedIn: false,
    userName: null as string | null,
    userEmail: null as string | null,
    currentSessionToken: null as string | null,
    userInfo: { role: 'USER' as UserRole },
    activeSessions: [] as UserSession[],
    preferences: {} as Record<string, any>,
  };
}

export const userStore = defineStore('user', {
  state: () => ({
    ...defaultAuthState(),
    filterPreferences: {
      exactMatch: false,
    },
  }),
  getters: {
    isAdmin: (state) => state.userInfo.role === 'ADMIN',
  },
  persist: import.meta.client
    ? {
        key: 'info',
        storage: piniaPluginPersistedstate.localStorage(),
        pick: ['filterPreferences', 'userInfo'],
      }
    : false,
  actions: {
    resetAuthState() {
      this.$patch(defaultAuthState());
    },

    async loginWithProvider(provider: 'google' | 'discord') {
      const { $i18n } = useNuxtApp();

      try {
        const response = await $fetch<{ url?: string; error?: { message?: string } }>('/v1/auth/sign-in/social', {
          method: 'POST',
          credentials: 'include',
          body: {
            provider,
            callbackURL: window.location.href,
            errorCallbackURL: window.location.href,
          },
        });

        if (response?.error) {
          useToastError($i18n.t('modalauth.labels.errorlogin400'));
          return;
        }

        if (response?.url) {
          window.location.href = response.url;
        }
      } catch {
        useToastError($i18n.t('modalauth.labels.errorlogin400'));
      }
    },

    async loginGoogle() {
      await this.loginWithProvider('google');
    },

    async loginDiscord() {
      await this.loginWithProvider('discord');
    },

    async impersonateDevUser(userId: number) {
      const { $i18n } = useNuxtApp();

      try {
        const sdk = useNadeshikoSdk();
        const { error } = await sdk.impersonateAdminUser({
          body: { userId },
        });

        if (error) {
          useToastError($i18n.t('modalauth.labels.errorlogin400'));
          return;
        }

        await this.getBasicInfo();
        if (this.isLoggedIn) {
          useToastSuccess($i18n.t('modalauth.labels.successfullogin'));
        }
      } catch {
        useToastError($i18n.t('modalauth.labels.errorlogin400'));
      }
    },

    async clearDevImpersonation() {
      try {
        const sdk = useNadeshikoSdk();
        await sdk.clearAdminImpersonation();
      } finally {
        this.resetAuthState();
      }
    },

    async logout(msg?: string) {
      const router = useRouter();
      const { $i18n } = useNuxtApp();

      try {
        await $fetch('/v1/auth/sign-out', { method: 'POST', credentials: 'include' });
      } catch {
        // no-op: clear local auth state even if sign out request fails
      }

      this.resetAuthState();
      router.push('/');
      useToastSuccess(msg ? msg : $i18n.t('modalauth.labels.logout'));
    },

    async getBasicInfo(): Promise<void> {
      try {
        const response = await $fetch<{ user?: any; session?: any }>('/v1/auth/get-session', {
          method: 'GET',
          credentials: 'include',
        });

        const sessionUser = response?.user;
        if (!sessionUser && !response?.session) {
          this.resetAuthState();
          return;
        }

        this.$patch({
          isLoggedIn: true,
          userName: sessionUser?.name ?? null,
          userEmail: sessionUser?.email ?? null,
          currentSessionToken: response?.session?.token ?? null,
          userInfo: { role: sessionUser?.role ?? 'USER' },
          preferences: sessionUser?.preferences ?? {},
        });
      } catch {
        this.resetAuthState();
      }
    },

    async listSessions(): Promise<UserSession[]> {
      try {
        const raw = await $fetch<unknown[]>('/v1/auth/list-sessions', {
          method: 'GET',
          credentials: 'include',
        });

        const normalized = Array.isArray(raw) ? (raw as UserSession[]) : [];
        this.activeSessions = normalized;
        return normalized;
      } catch {
        this.activeSessions = [];
        return [];
      }
    },

    async revokeSession(token: string): Promise<boolean> {
      try {
        await $fetch('/v1/auth/revoke-session', {
          method: 'POST',
          credentials: 'include',
          body: { token },
        });

        await this.listSessions();
        await this.getBasicInfo();
        return true;
      } catch {
        return false;
      }
    },

    async revokeSessions(): Promise<boolean> {
      try {
        await $fetch('/v1/auth/revoke-sessions', {
          method: 'POST',
          credentials: 'include',
        });

        await this.logout();
        return true;
      } catch {
        return false;
      }
    },

    async revokeOtherSessions(): Promise<boolean> {
      try {
        await $fetch('/v1/auth/revoke-other-sessions', {
          method: 'POST',
          credentials: 'include',
        });

        await this.listSessions();
        return true;
      } catch {
        return false;
      }
    },

    async deleteAccount(): Promise<boolean> {
      try {
        await $fetch('/v1/auth/delete-user', {
          method: 'POST',
          credentials: 'include',
          body: {},
        });

        this.resetAuthState();
        return true;
      } catch {
        return false;
      }
    },
  },
});
