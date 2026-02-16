import { useNuxtApp } from '#app';
import { defineStore } from 'pinia';
import { authApiRequest } from '~/utils/authApi';
import { signInSocial, signOut as authSignOut } from '~/utils/authClient';

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

    async loginGoogle() {
      const { $i18n } = useNuxtApp();

      try {
        const result = await signInSocial({
          provider: 'google',
          callbackURL: window.location.href,
          errorCallbackURL: window.location.href,
        });

        if (result?.error) {
          useToastError($i18n.t('modalauth.labels.errorlogin400'));
        }
      } catch {
        useToastError($i18n.t('modalauth.labels.errorlogin400'));
      }
    },

    async loginDiscord() {
      const { $i18n } = useNuxtApp();

      try {
        const result = await signInSocial({
          provider: 'discord',
          callbackURL: window.location.href,
          errorCallbackURL: window.location.href,
        });

        if (result?.error) {
          useToastError($i18n.t('modalauth.labels.errorlogin400'));
        }
      } catch {
        useToastError($i18n.t('modalauth.labels.errorlogin400'));
      }
    },

    async impersonateDevUser(userId: number) {
      const { $i18n } = useNuxtApp();

      try {
        const response = await authApiRequest('/v1/dev/auth/impersonate', {
          method: 'POST',
          body: { userId },
        });

        if (!response.ok) {
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
        await authApiRequest('/v1/dev/auth/impersonate/clear', {
          method: 'POST',
        });
      } finally {
        this.resetAuthState();
      }
    },

    async logout(msg?: string) {
      const router = useRouter();
      const { $i18n } = useNuxtApp();

      try {
        await authSignOut();
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
      } catch (error) {
        console.error('[getBasicInfo] Error fetching session:', error);
        this.resetAuthState();
      }
    },

    async listSessions(): Promise<UserSession[]> {
      try {
        const response = await authApiRequest<UserSession[]>('/v1/auth/list-sessions', {
          method: 'GET',
        });

        if (!response.ok) {
          throw new Error('Unable to list sessions');
        }

        const normalized = Array.isArray(response.data) ? response.data : [];
        this.activeSessions = normalized;
        return normalized;
      } catch (error) {
        console.error(error);
        this.activeSessions = [];
        return [];
      }
    },

    async revokeSession(token: string): Promise<boolean> {
      try {
        const response = await authApiRequest('/v1/auth/revoke-session', {
          method: 'POST',
          body: { token },
        });

        if (!response.ok) {
          return false;
        }

        await this.listSessions();
        await this.getBasicInfo();
        return true;
      } catch (error) {
        console.error(error);
        return false;
      }
    },

    async revokeSessions(): Promise<boolean> {
      try {
        const response = await authApiRequest('/v1/auth/revoke-sessions', {
          method: 'POST',
        });

        if (!response.ok) {
          return false;
        }

        await this.logout();
        return true;
      } catch (error) {
        console.error(error);
        return false;
      }
    },

    async revokeOtherSessions(): Promise<boolean> {
      try {
        const response = await authApiRequest('/v1/auth/revoke-other-sessions', {
          method: 'POST',
        });

        if (!response.ok) {
          return false;
        }

        await this.listSessions();
        return true;
      } catch (error) {
        console.error(error);
        return false;
      }
    },

    async deleteAccount(): Promise<boolean> {
      try {
        const response = await authApiRequest('/v1/auth/delete-user', {
          method: 'POST',
          body: {},
        });

        if (!response.ok) {
          return false;
        }

        this.resetAuthState();
        return true;
      } catch (error) {
        console.error(error);
        return false;
      }
    },
  },
});
