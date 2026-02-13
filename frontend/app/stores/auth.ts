import { useNuxtApp } from '#app';
import { defineStore } from 'pinia';
import { authApiRequest } from '~/utils/authApi';
import { signInSocial, signOut as authSignOut } from '~/utils/authClient';

type UserRole = {
  id_role: number;
  name?: string;
};

export type UserSession = {
  token: string;
  expiresAt?: string;
  createdAt?: string;
  updatedAt?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

type BasicInfoResponse = {
  user?: {
    username?: string;
    email?: string;
    roles?: UserRole[];
  };
} | null;

export const userStore = defineStore('user', {
  state: () => ({
    isLoggedIn: false,
    userName: null as string | null,
    userEmail: null as string | null,
    currentSessionToken: null as string | null,
    filterPreferences: {
      exactMatch: false,
    },
    userInfo: {
      roles: [] as UserRole[],
    },
    activeSessions: [] as UserSession[],
  }),
  getters: {
    isAdmin: (state) => state.userInfo.roles?.some((role: UserRole) => role.id_role === 1),
  },
  persist: import.meta.client
    ? {
        key: 'info',
        storage: piniaPluginPersistedstate.localStorage(),
        pick: ['filterPreferences', 'userInfo'],
      }
    : false,
  actions: {
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
        this.$patch((state) => {
          state.isLoggedIn = false;
          state.userName = null;
          state.userEmail = null;
          state.currentSessionToken = null;
          state.userInfo = { roles: [] };
          state.activeSessions = [];
        });
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

      this.$patch((state) => {
        state.isLoggedIn = false;
        state.userName = null;
        state.userEmail = null;
        state.currentSessionToken = null;
        state.userInfo = { roles: [] };
        state.activeSessions = [];
      });

      router.push('/');
      useToastSuccess(msg ? msg : $i18n.t('modalauth.labels.logout'));
    },

    async getBasicInfo(): Promise<BasicInfoResponse> {
      try {
        // Fetch session from backend (cookies are HttpOnly, can't read from JS)
        const response = await $fetch<{ user?: any; session?: any }>('/v1/auth/get-session', {
          method: 'GET',
          credentials: 'include',
        });

        console.log('[getBasicInfo] Session response:', response);

        const sessionUser = response?.user;
        const hasSession = Boolean(sessionUser || response?.session);

        if (!hasSession) {
          this.$patch((state) => {
            state.isLoggedIn = false;
            state.userName = null;
            state.userEmail = null;
            state.currentSessionToken = null;
            state.userInfo = { roles: [] };
            state.activeSessions = [];
          });
          return null;
        }

        const responseData: BasicInfoResponse = {
          user: {
            username: sessionUser?.name ?? undefined,
            email: sessionUser?.email ?? undefined,
            roles: [],
          },
        };

        this.$patch((state) => {
          state.isLoggedIn = true;
          state.userName = sessionUser?.name ?? null;
          state.userEmail = sessionUser?.email ?? null;
          state.currentSessionToken = response?.session?.token ?? null;
          state.userInfo = { roles: [] };
        });

        return responseData;
      } catch (error) {
        console.error('[getBasicInfo] Error fetching session:', error);
        this.$patch((state) => {
          state.isLoggedIn = false;
          state.userName = null;
          state.userEmail = null;
          state.currentSessionToken = null;
          state.userInfo = { roles: [] };
          state.activeSessions = [];
        });
        return null;
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

        this.$patch((state) => {
          state.activeSessions = normalized;
        });

        return normalized;
      } catch (error) {
        console.error(error);
        this.$patch((state) => {
          state.activeSessions = [];
        });
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

        this.$patch((state) => {
          state.isLoggedIn = false;
          state.userName = null;
          state.userEmail = null;
          state.currentSessionToken = null;
          state.userInfo = { roles: [] };
          state.activeSessions = [];
        });

        return true;
      } catch (error) {
        console.error(error);
        return false;
      }
    },
  },
});
