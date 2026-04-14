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
    isImpersonating: false,
    impersonatedUsername: null as string | null,
  };
}

const IMPERSONATION_BACKUP_KEYS = ['labs', 'anki-active-profile', 'nd-last-collection'] as const;
const IMPERSONATION_BACKUP_SESSION_KEY = '_nade_impersonation_backup';

function backupAndClearImpersonationState() {
  if (!import.meta.client) return;
  const backup: Record<string, string | null> = {};
  for (const key of IMPERSONATION_BACKUP_KEYS) {
    backup[key] = localStorage.getItem(key);
    localStorage.removeItem(key);
  }
  sessionStorage.setItem(IMPERSONATION_BACKUP_SESSION_KEY, JSON.stringify(backup));
}

function restoreImpersonationStateBackup() {
  if (!import.meta.client) return;
  const raw = sessionStorage.getItem(IMPERSONATION_BACKUP_SESSION_KEY);
  if (!raw) return;
  try {
    const backup = JSON.parse(raw) as Record<string, string | null>;
    for (const key of IMPERSONATION_BACKUP_KEYS) {
      if (backup[key] !== null && backup[key] !== undefined) {
        localStorage.setItem(key, backup[key] as string);
      } else {
        localStorage.removeItem(key);
      }
    }
  } finally {
    sessionStorage.removeItem(IMPERSONATION_BACKUP_SESSION_KEY);
  }
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
        pick: ['filterPreferences'],
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

    async sendMagicLink(email: string): Promise<boolean> {
      try {
        const callbackURL = '/?magic_callback=1';
        await $fetch('/v1/auth/sign-in/magic-link', {
          method: 'POST',
          credentials: 'include',
          body: { email, callbackURL },
        });
        return true;
      } catch {
        return false;
      }
    },

    async impersonateUser(userId: number) {
      const { $i18n } = useNuxtApp();

      try {
        backupAndClearImpersonationState();
        await $fetch('/v1/auth/admin/impersonate-user', {
          method: 'POST',
          credentials: 'include',
          body: { userId: String(userId) },
        });
        await this.getBasicInfo();
        await useLabsStore().fetchFeatures();
        if (this.isLoggedIn) {
          useToastSuccess($i18n.t('modalauth.labels.successfullogin'));
        }
      } catch {
        restoreImpersonationStateBackup();
        useToastError($i18n.t('modalauth.labels.errorlogin400'));
      }
    },

    async stopImpersonating() {
      try {
        await $fetch('/v1/auth/admin/stop-impersonating', {
          method: 'POST',
          credentials: 'include',
        });
        restoreImpersonationStateBackup();
        await this.getBasicInfo();
        await useLabsStore().fetchFeatures();
      } catch {
        restoreImpersonationStateBackup();
        this.resetAuthState();
      } finally {
        window.location.href = '/';
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

      if (import.meta.client) {
        const posthog = usePostHog();
        posthog?.capture('user_logged_out');
        posthog?.reset();
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

        const impersonating = !!response?.session?.impersonatedBy;
        const wasLoggedIn = this.isLoggedIn;
        this.$patch({
          isLoggedIn: true,
          userName: sessionUser?.name ?? null,
          userEmail: sessionUser?.email ?? null,
          currentSessionToken: response?.session?.token ?? null,
          userInfo: { role: sessionUser?.role ?? 'USER' },
          isImpersonating: impersonating,
          impersonatedUsername: impersonating ? (sessionUser?.name ?? null) : null,
        });

        if (!wasLoggedIn && sessionUser?.createdAt) {
          const createdAt = new Date(sessionUser.createdAt).getTime();
          const now = Date.now();
          if (now - createdAt < 60_000) {
            const posthog = usePostHog();
            posthog?.capture('signup_completed', {
              provider: sessionUser?.provider ?? 'unknown',
            });
          }
        }

        this.preferences = await $fetch<Record<string, any>>('/v1/user/preferences', {
          method: 'GET',
          credentials: 'include',
        }).catch(() => ({}));
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

    async changeEmail(newEmail: string): Promise<{ success: boolean; error?: string }> {
      try {
        await $fetch('/v1/auth/change-email', {
          method: 'POST',
          credentials: 'include',
          body: {
            newEmail,
            callbackURL: `${window.location.origin}/settings`,
          },
        });
        return { success: true };
      } catch (error: any) {
        const message = error?.data?.message || error?.message || 'Failed to change email';
        return { success: false, error: message };
      }
    },

    async deleteAccount(): Promise<boolean> {
      try {
        await $fetch('/v1/auth/delete-user', {
          method: 'POST',
          credentials: 'include',
          body: {},
        });

        if (import.meta.client) {
          const posthog = usePostHog();
          posthog?.capture('account_deleted');
          posthog?.reset();
        }

        this.resetAuthState();
        return true;
      } catch {
        return false;
      }
    },
  },
});
