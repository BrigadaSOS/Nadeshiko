import { useNuxtApp } from '#app';
import type { UserPreferences } from '@brigadasos/nadeshiko-sdk';
import { defineStore } from 'pinia';
import { handleApiError } from '~/utils/apiError';

type UserRole = 'ADMIN' | 'MOD' | 'USER' | 'PATREON';

export type UserSession = {
  token: string;
  expiresAt?: string;
  createdAt?: string;
  updatedAt?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/** The shape of a better-auth session as both entry points receive it. */
export interface SessionUser {
  name?: string | null;
  email?: string | null;
  role?: string | null;
  createdAt?: string | null;
  provider?: string | null;
}

export interface SessionInfo {
  token?: string | null;
  impersonatedBy?: unknown;
}

function defaultAuthState() {
  return {
    isLoggedIn: false,
    userName: null as string | null,
    userEmail: null as string | null,
    currentSessionToken: null as string | null,
    userInfo: { role: 'USER' as UserRole },
    activeSessions: [] as UserSession[],
    preferences: {} as UserPreferences,
    isImpersonating: false,
    impersonatedUsername: null as string | null,
  };
}

const IMPERSONATION_BACKUP_KEYS = ['anki-active-profile', 'nd-last-collection'] as const;
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

/**
 * Runs an action and reports failure as `false` rather than throwing.
 *
 * The session screens render their own inline error next to the control that
 * failed, so these actions must resolve either way. Each differed only in which
 * follow-up it ran afterwards.
 */
async function reportedAsBoolean(errorKey: string, run: () => Promise<void>): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (error) {
    handleApiError(errorKey, error, { toastKey: false });
    return false;
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

    /**
     * Writes a better-auth session into auth state, or clears it when there is none.
     *
     * Both entry points land here: the SSR plugin bootstrapping from the cookie, and
     * the client re-reading after a login, impersonation switch or callback. The
     * mapping used to be spelled out in both, so a field added to the session could
     * be picked up on one path and not the other -- leaving the server-rendered page
     * and the hydrated app disagreeing about who is signed in, or about their role.
     */
    applySession(response: { user?: SessionUser | null; session?: SessionInfo | null } | null): boolean {
      const sessionUser = response?.user;
      if (!sessionUser && !response?.session) {
        this.resetAuthState();
        return false;
      }

      const impersonating = !!response?.session?.impersonatedBy;
      this.$patch({
        isLoggedIn: true,
        userName: sessionUser?.name ?? null,
        userEmail: sessionUser?.email ?? null,
        currentSessionToken: response?.session?.token ?? null,
        userInfo: { role: (sessionUser?.role as UserRole) ?? 'USER' },
        isImpersonating: impersonating,
        impersonatedUsername: impersonating ? (sessionUser?.name ?? null) : null,
      });

      return true;
    },

    async loginWithProvider(provider: 'google' | 'discord') {
      const { $i18n } = useNuxtApp();

      try {
        const response = await useNadeshikoSdk().socialSignIn({
          provider,
          callbackURL: window.location.href,
          errorCallbackURL: window.location.href,
        });

        // The spec declares no `error` field -- better-auth signals failure with a
        // non-2xx, which throws below. This guard predates the contract though, and
        // better-auth's generated schema has already proved not to describe this
        // deployment exactly (see SCHEMA_CORRECTIONS in generateAuthSpec.ts), so it
        // is kept rather than deleted on the strength of that schema.
        const declaredError = (response as { error?: { message?: string } })?.error;
        if (declaredError) {
          useToastError($i18n.t('modalauth.labels.errorlogin400'));
          return;
        }

        if (response?.url) {
          window.location.href = response.url;
        }
      } catch (error) {
        handleApiError('auth:social-login-failed', error, {
          toastKey: 'modalauth.labels.errorlogin400',
          context: { provider },
        });
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
        await useNadeshikoSdk().signInWithMagicLink({ email, callbackURL });
        return true;
      } catch (error) {
        // The caller renders the failure inline in the auth modal.
        handleApiError('auth:magic-link-request-failed', error, { toastKey: false });
        return false;
      }
    },

    async impersonateUser(userId: number) {
      const { $i18n } = useNuxtApp();

      try {
        backupAndClearImpersonationState();
        await useNadeshikoSdk().impersonateUser({ userId });
        await this.getBasicInfo();
        if (this.isLoggedIn) {
          useToastSuccess($i18n.t('modalauth.labels.successfullogin'));
        }
      } catch (error) {
        restoreImpersonationStateBackup();
        handleApiError('auth:impersonate-failed', error, { toastKey: 'modalauth.labels.errorlogin400' });
      }
    },

    async stopImpersonating() {
      try {
        await useNadeshikoSdk().authAdminStopImpersonating();
        restoreImpersonationStateBackup();
        await this.getBasicInfo();
      } catch (error) {
        // Reload to `/` happens either way, so the toast would be destroyed before
        // it could be read; the report is what matters here.
        handleApiError('auth:stop-impersonating-failed', error, { toastKey: false });
        restoreImpersonationStateBackup();
        this.resetAuthState();
      } finally {
        window.location.href = '/';
      }
    },

    async logout(msg?: string) {
      const router = useRouter();
      const localePath = useLocalePath();
      const { $i18n } = useNuxtApp();

      try {
        await useNadeshikoSdk().signOut({});
      } catch (error) {
        // Local auth state is cleared regardless, and the success toast below still
        // fires, so surface nothing to the user -- but do not lose the failure.
        handleApiError('auth:sign-out-failed', error, { toastKey: false });
      }

      if (import.meta.client) {
        const posthog = usePostHog();
        posthog?.capture('user_logged_out');
        posthog?.reset();
      }

      this.resetAuthState();
      router.push(localePath('/'));
      useToastSuccess(msg ? msg : $i18n.t('modalauth.labels.logout'));
    },

    async getBasicInfo(): Promise<void> {
      try {
        const response = await useNadeshikoSdk().getSession();

        // The generated `AuthUser` is better-auth's base schema. `customSession` in
        // config/auth.ts enriches what the server actually returns (role, provider),
        // and the generator has no way to see that, so the enriched fields are read
        // through our own `SessionUser` -- which is the type that documents them.
        const sessionUser = response?.user as SessionUser | undefined;
        const wasLoggedIn = this.isLoggedIn;

        if (!this.applySession(response)) return;

        if (!wasLoggedIn && sessionUser?.createdAt) {
          const createdAt = new Date(sessionUser.createdAt).getTime();
          const now = Date.now();
          if (now - createdAt < 300_000) {
            const posthog = usePostHog();
            posthog?.capture('signup_completed', {
              provider: sessionUser?.provider ?? 'unknown',
            });
          }
        }

        this.preferences = await useNadeshikoSdk()
          .getUserPreferences()
          .catch((error: unknown) => {
            // Preferences are additive: every reader falls back to a default, so the
            // session stays usable. Report it rather than toasting on every page load.
            handleApiError('auth:preferences-fetch-failed', error, { toastKey: false });
            return {} as UserPreferences;
          });
      } catch (error: any) {
        // Only a 401 means the session is really gone. Backend 5xx, a network
        // blip or a rate limit must not silently log out a valid session.
        const status = error?.status ?? error?.statusCode ?? error?.response?.status;
        if (status === 401) {
          this.resetAuthState();
        }
        handleApiError('auth:session-fetch-failed', error, {
          toastKey: false,
          context: { recovered: status === 401 ? 'reset' : 'kept-session' },
        });
      }
    },

    async listSessions(): Promise<UserSession[]> {
      try {
        const raw = await useNadeshikoSdk().listUserSessions();

        const normalized = Array.isArray(raw) ? (raw as UserSession[]) : [];
        this.activeSessions = normalized;
        return normalized;
      } catch (error) {
        // AccountSettings tells an empty list apart from a failure via `sessionsError`.
        handleApiError('auth:list-sessions-failed', error, { toastKey: false });
        this.activeSessions = [];
        return [];
      }
    },

    revokeSession(token: string): Promise<boolean> {
      return reportedAsBoolean('auth:revoke-session-failed', async () => {
        await useNadeshikoSdk().authRevokeSession({ token });
        await this.listSessions();
        await this.getBasicInfo();
      });
    },

    revokeSessions(): Promise<boolean> {
      return reportedAsBoolean('auth:revoke-sessions-failed', async () => {
        await useNadeshikoSdk().authRevokeSessions({});
        await this.logout();
      });
    },

    revokeOtherSessions(): Promise<boolean> {
      return reportedAsBoolean('auth:revoke-other-sessions-failed', async () => {
        await useNadeshikoSdk().authRevokeOtherSessions({});
        await this.listSessions();
      });
    },

    async changeEmail(newEmail: string): Promise<{ success: boolean; error?: string }> {
      try {
        await useNadeshikoSdk().changeEmail({
          newEmail,
          callbackURL: `${window.location.origin}/settings`,
        });
        return { success: true };
      } catch (error: unknown) {
        // The caller renders the returned message inline next to the email field.
        handleApiError('auth:change-email-failed', error, { toastKey: false });
        const message =
          (error as { data?: { message?: string } })?.data?.message ||
          (error instanceof Error ? error.message : '') ||
          'Failed to change email';
        return { success: false, error: message };
      }
    },

    async deleteAccount(): Promise<boolean> {
      try {
        await useNadeshikoSdk().deleteUser({});

        if (import.meta.client) {
          const posthog = usePostHog();
          posthog?.capture('account_deleted');
          posthog?.reset();
        }

        this.resetAuthState();
        return true;
      } catch (error) {
        // The caller renders `deleteAccountError` inline in the danger-zone panel.
        handleApiError('auth:delete-account-failed', error, { toastKey: false });
        return false;
      }
    },
  },
});
