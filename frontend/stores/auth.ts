import { useNuxtApp } from '#app';
import { defineStore } from 'pinia';

type UserRole = {
  id_role: number;
  name?: string;
};

type BasicInfoResponse = {
  user?: {
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
      });

      router.push('/');
      useToastSuccess(msg ? msg : $i18n.t('modalauth.labels.logout'));
    },

    async getBasicInfo(): Promise<BasicInfoResponse> {
      const config = useRuntimeConfig();
      const auth = getAuthClient();

      try {
        const session = await auth.getSession();
        const hasSession = Boolean(session?.data?.user || session?.data?.session);

        if (!hasSession) {
          this.$patch((state) => {
            state.isLoggedIn = false;
            state.userInfo = { roles: [] };
          });
          return null;
        }

        const response = await fetch(`${config.public.backendUrl}/v1/auth/identity/me`, {
          method: 'GET',
          mode: 'cors',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
        });

        if (!response.ok) {
          this.$patch((state) => {
            state.isLoggedIn = false;
            state.userInfo = { roles: [] };
          });
          return null;
        }

        const responseData = (await response.json()) as BasicInfoResponse;

        this.$patch((state) => {
          state.isLoggedIn = true;
          state.userInfo = {
            roles: responseData?.user?.roles || [],
          };
        });

        return responseData;
      } catch {
        this.$patch((state) => {
          state.isLoggedIn = false;
          state.userInfo = { roles: [] };
        });
        return null;
      }
    },
  },
});
