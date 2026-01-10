import { useNuxtApp } from '#app';
import { defineStore } from 'pinia';

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
      exact_match: false,
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
        paths: ['isLoggedIn', 'filterPreferences', 'userInfo'],
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
      const config = useRuntimeConfig();
      const { $i18n } = useNuxtApp();

      try {
        const response = await fetch(`${config.public.backendUrl}/v1/dev/auth/impersonate`, {
          method: 'POST',
          mode: 'cors',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ userId }),
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
      const config = useRuntimeConfig();

      try {
        await fetch(`${config.public.backendUrl}/v1/dev/auth/impersonate/clear`, {
          method: 'POST',
          mode: 'cors',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
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
      const config = useRuntimeConfig();

      try {
        const response = await fetch(`${config.public.backendUrl}/api/auth/list-sessions`, {
          method: 'GET',
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error('Unable to list sessions');
        }

        const sessions = (await response.json()) as UserSession[];
        const normalized = Array.isArray(sessions) ? sessions : [];

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
      const config = useRuntimeConfig();

      try {
        const response = await fetch(`${config.public.backendUrl}/api/auth/revoke-session`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token }),
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
      const config = useRuntimeConfig();

      try {
        const response = await fetch(`${config.public.backendUrl}/api/auth/revoke-sessions`, {
          method: 'POST',
          credentials: 'include',
        });

        if (!response.ok) {
          return false;
        }

        await this.getBasicInfo();
        this.$patch((state) => {
          state.activeSessions = [];
        });
        return true;
      } catch (error) {
        console.error(error);
        return false;
      }
    },

    async revokeOtherSessions(): Promise<boolean> {
      const config = useRuntimeConfig();

      try {
        const response = await fetch(`${config.public.backendUrl}/api/auth/revoke-other-sessions`, {
          method: 'POST',
          credentials: 'include',
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
      const config = useRuntimeConfig();

      try {
        const response = await fetch(`${config.public.backendUrl}/api/auth/delete-user`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
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
