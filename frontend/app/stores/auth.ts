import { useNuxtApp } from '#app';
import { defineStore } from 'pinia';
import { authApiRequest } from '~/utils/authApi';

type UserRole = {
  id_role: number;
  name?: string;
};

type UserSession = {
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

function getAuthClient(): any {
  const nuxtApp = useNuxtApp() as any;
  if (!nuxtApp.$auth) {
    throw new Error('better-auth client is not available');
  }
  return nuxtApp.$auth;
}

export const userStore = defineStore('user', {
  state: () => ({
    isLoggedIn: false,
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
      const auth = getAuthClient();
      const { $i18n } = useNuxtApp();

      try {
        const result = await auth.signIn.social({
          provider: 'google',
          callbackURL: window.location.href,
        });

        if (result?.error) {
          useToastError($i18n.t('modalauth.labels.errorlogin400'));
        }
      } catch {
        useToastError($i18n.t('modalauth.labels.errorlogin400'));
      }
    },

    async loginDiscord() {
      const auth = getAuthClient();
      const { $i18n } = useNuxtApp();

      try {
        const result = await auth.signIn.social({
          provider: 'discord',
          callbackURL: window.location.href,
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
          state.userInfo = { roles: [] };
          state.activeSessions = [];
        });
      }
    },

    async logout(msg?: string) {
      const auth = getAuthClient();
      const router = useRouter();
      const { $i18n } = useNuxtApp();

      try {
        await auth.signOut();
      } catch {
        // no-op: clear local auth state even if sign out request fails
      }

      this.$patch((state) => {
        state.isLoggedIn = false;
        state.userInfo = { roles: [] };
        state.activeSessions = [];
      });

      router.push('/');
      useToastSuccess(msg ? msg : $i18n.t('modalauth.labels.logout'));
    },

    async getBasicInfo(): Promise<BasicInfoResponse> {
      const auth = getAuthClient();

      try {
        const session = await auth.getSession();
        const sessionUser = session?.data?.user;
        const hasSession = Boolean(sessionUser || session?.data?.session);

        if (!hasSession) {
          this.$patch((state) => {
            state.isLoggedIn = false;
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
          state.userInfo = { roles: [] };
        });

        return responseData;
      } catch {
        this.$patch((state) => {
          state.isLoggedIn = false;
          state.userInfo = { roles: [] };
          state.activeSessions = [];
        });
        return null;
      }
    },

    async listSessions(): Promise<UserSession[]> {
      try {
        const response = await authApiRequest<UserSession[]>('/api/auth/list-sessions', {
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
        const response = await authApiRequest('/api/auth/revoke-session', {
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
        const response = await authApiRequest('/api/auth/revoke-sessions', {
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
        const response = await authApiRequest('/api/auth/revoke-other-sessions', {
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
        const response = await authApiRequest('/api/auth/delete-user', {
          method: 'POST',
          body: {},
        });

        if (!response.ok) {
          return false;
        }

        this.$patch((state) => {
          state.isLoggedIn = false;
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
