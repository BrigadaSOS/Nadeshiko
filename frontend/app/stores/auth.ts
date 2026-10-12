import { useNuxtApp } from '#app';
import type { UserPreferences } from '@brigadasos/nadeshiko-sdk';
import { defineStore } from 'pinia';
import { setReaderStack } from '~/utils/wordLookup';
import { MAGIC_LINK_HOLD_BACKS } from '~/utils/magicLinkHoldBack';
import { apiErrorStatus, handleApiError } from '~/utils/apiError';
import { reportEvent } from '~/utils/reportError';
import { splitLocalePrefix } from '~/utils/routes';
import {
  ANALYTICS_DELIBERATE_SIGN_OUT_KEY,
  AUTH_CALLBACK_PATH,
  AUTH_CALLBACK_PARAM,
  authIntentStorage,
  authReturnToStorage,
  consumeAuthReturnTo,
  rememberAuthReturnTo,
  readAuthIntent,
  withAuthIntentParams,
  writeStoredValue,
} from '~/utils/authAnalytics';

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
  /** PostHog uses the immutable, unique account id; display names are neither. */
  id?: string | null;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  createdAt?: string | null;
  /**
   * Linked Shirabe state comes with the session. stackFingerprint invalidates browser-cached
   * lookups when the reader changes their dictionaries.
   */
  shirabe?: {
    linked?: boolean;
    stackFingerprint?: string | null;
    /** Which languages they read definitions in, and in what order, as their
     *  Shirabe stack says (`jmdict:es` above `jmdict:en` means Spanish first).
     *  Empty when the stack names no gloss language. */
    glossLanguages?: string[] | null;
  } | null;
}

export interface SessionInfo {
  /**
   * The session row's primary key -- not its token. Safe to keep in readable
   * storage, and it changes only on a genuine new sign-in, which is what lets a
   * login be counted exactly rather than guessed at.
   */
  id?: string | null;
  token?: string | null;
  impersonatedBy?: unknown;
  /**
   * Server-provided session start used to report lost-session age and detect clustered
   * mechanical expiry.
   */
  createdAt?: string | null;
}

function defaultAuthState() {
  return {
    isLoggedIn: false,
    userId: null as string | null,
    /** Identifies the session itself; see `SessionInfo.id`. */
    sessionId: null as string | null,
    /** ISO timestamp the session began; see `SessionInfo.createdAt`. */
    sessionCreatedAt: null as string | null,
    /** ISO timestamp the account was created, used to tell a signup from a login. */
    userCreatedAt: null as string | null,
    userName: null as string | null,
    userEmail: null as string | null,
    currentSessionToken: null as string | null,
    userInfo: { role: 'USER' as UserRole },
    /** Which Shirabe dictionary stack this reader's word lookups come from, or
     *  null when they have not linked an account. See `SessionUser.shirabe`. */
    shirabeStackFingerprint: null as string | null,
    /** The gloss language order their Shirabe stack implies. Empty when they have
     *  linked nothing, or when the stack names no gloss language at all. */
    shirabeGlossLanguages: [] as string[],
    /** Whether a Shirabe account is linked at all. Not the same question as the
     *  two above: a reader can be linked and have neither a fingerprint copied
     *  yet nor a gloss language in their stack. */
    shirabeLinked: false,
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
      setReaderStack(null);
    },

    /**
     * Share one session mapping between SSR bootstrap and client refresh so identity and role
     * agree after hydration.
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
        userId: sessionUser?.id != null ? String(sessionUser.id) : null,
        sessionId: response?.session?.id != null ? String(response.session.id) : null,
        sessionCreatedAt: response?.session?.createdAt ?? null,
        userCreatedAt: sessionUser?.createdAt ?? null,
        userName: sessionUser?.name ?? null,
        userEmail: sessionUser?.email ?? null,
        currentSessionToken: response?.session?.token ?? null,
        userInfo: { role: (sessionUser?.role as UserRole) ?? 'USER' },
        shirabeStackFingerprint: sessionUser?.shirabe?.stackFingerprint ?? null,
        shirabeGlossLanguages: sessionUser?.shirabe?.glossLanguages ?? [],
        shirabeLinked: sessionUser?.shirabe?.linked === true,
        isImpersonating: impersonating,
        impersonatedUsername: impersonating ? (sessionUser?.name ?? null) : null,
      });

      // The word-lookup cache keys on this, and cannot reach in for it: see
      // `setReaderStack`. Pushed from the one place that knows a session landed.
      setReaderStack(sessionUser?.shirabe?.stackFingerprint);

      return true;
    },

    async loginWithProvider(provider: 'google' | 'discord') {
      const { $i18n } = useNuxtApp();

      reportEvent('auth_provider_attempted', { provider });

      try {
        const callbackPath = useLocalePath()(`${AUTH_CALLBACK_PATH}?${AUTH_CALLBACK_PARAM}=1`);
        rememberAuthReturnTo(authReturnToStorage(), window.location.href, window.location.origin);
        const response = await useNadeshikoSdk().socialSignIn({
          // Always return through one stable, Cloudflare-exempt route. The
          // original page is parked in sessionStorage and restored after the
          // callback, so a challenge on /search or /sentence cannot interrupt
          // the OAuth round trip.
          callbackURL: `${window.location.origin}${callbackPath}`,
          errorCallbackURL: `${window.location.origin}${callbackPath}`,
          provider,
        });

        // The spec declares no `error` field -- better-auth signals failure with a
        // non-2xx, which throws below. This guard predates the contract though, and
        // better-auth's generated schema has already proved not to describe this
        // deployment exactly (see SCHEMA_CORRECTIONS in generateAuthSpec.ts), so it
        // is kept rather than deleted on the strength of that schema.
        const declaredError = (response as { error?: { message?: string } })?.error;
        if (declaredError) {
          consumeAuthReturnTo(authReturnToStorage());
          useToastError($i18n.t('modalauth.labels.errorlogin400'));
          return;
        }

        if (response?.url) {
          reportEvent('auth_provider_redirected', { provider });
          window.location.href = response.url;
        }
      } catch (error) {
        consumeAuthReturnTo(authReturnToStorage());
        reportEvent('auth_provider_request_failed', {
          provider,
          'http.status_code': String(apiErrorStatus(error) ?? 0),
        });
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

    /**
     * Distinguish a failed send from throttling so the UI can count down instead of showing a
     * generic error.
     */
    async sendMagicLink(
      email: string,
    ): Promise<{ status: 'ok' } | { status: 'rate-limited'; retryAfterSeconds: number } | { status: 'failed' }> {
      try {
        // Keep magic_callback for existing emailed links. URL intent supports sign-in on
        // another device; locally parked intent takes precedence.
        const callbackURL = withAuthIntentParams(
          `/?magic_callback=1&${AUTH_CALLBACK_PARAM}=1`,
          readAuthIntent(authIntentStorage(), Date.now()),
        );
        await useNadeshikoSdk().signInWithMagicLink({ email, callbackURL });
        return { status: 'ok' };
      } catch (error) {
        // The caller renders the failure inline in the auth modal.
        handleApiError('auth:magic-link-request-failed', error, { toastKey: false });

        const status =
          (error as { status?: number; response?: { status?: number } })?.status ??
          (error as { response?: { status?: number } })?.response?.status;

        if (status === 429) {
          // The SDK already lifts `Retry-After` off the response for us. The
          // fallback is the shortest hold-back rather than zero, so a server
          // that answered 429 without the header still produces a wait instead
          // of a button that invites an immediate second refusal.
          const retryAfterSeconds = (error as { retryAfterSeconds?: number })?.retryAfterSeconds;
          return { status: 'rate-limited', retryAfterSeconds: retryAfterSeconds ?? MAGIC_LINK_HOLD_BACKS[0] };
        }

        return { status: 'failed' };
      }
    },

    /**
     * Codes require the sealed cookie in the browser that requested the email. Distinguish
     * wrong-browser from retryable failure; see backend/app/services/auth/loginCode.ts.
     */
    async signInWithCode(email: string, code: string): Promise<'ok' | 'wrong-browser' | 'failed'> {
      try {
        await useNadeshikoSdk().signInWithEmailOtp({ email, otp: code });
        await this.getBasicInfo();
        return 'ok';
      } catch (error) {
        const status =
          (error as { status?: number; response?: { status?: number } })?.status ??
          (error as { response?: { status?: number } })?.response?.status;
        // The browser SDK normalises Better Auth's `{ code, message }` response
        // into `NadeshikoError`, where the code lives directly on the error. The
        // mocked store tests use the raw `{ data: { code } }` shape, so accept
        // both; otherwise a real wrong-browser response is shown as the generic
        // invalid-code copy and loses the advice to open the email link.
        const authError = error as { code?: string; data?: { code?: string } };
        const detail = authError.data?.code ?? authError.code;

        handleApiError('auth:login-code-failed', error, { toastKey: false });
        if (status === 400 && detail === 'LOGIN_CODE_NOT_BOUND') return 'wrong-browser';
        return 'failed';
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
        // Marks this sign-out as the reader's own doing, so the next load does
        // not report it as a session they lost. See `reportLostSession`.
        writeStoredValue(authIntentStorage(), ANALYTICS_DELIBERATE_SIGN_OUT_KEY, String(Date.now()));
        // Reset PostHog but retain ANALYTICS_IDENTITY_KEY so signing back in during the
        // new-account window cannot report another signup.
        posthog?.reset();
      }

      this.resetAuthState();

      // Keep the reader's place on public pages. Redirect only /user routes, whose auth guard
      // would redirect anyway; legacy settings and admin routes already redirect there.
      const { localizedPath } = splitLocalePrefix(router.currentRoute.value.path);
      if (localizedPath === '/user' || localizedPath.startsWith('/user/')) {
        await router.push(localePath('/'));
      }

      useToastSuccess(msg ? msg : $i18n.t('modalauth.labels.logout'));
    },

    async getBasicInfo(): Promise<void> {
      try {
        const response = await useNadeshikoSdk().getSession();

        // applySession handles customSession fields beyond the generated base schema.
        // identity-auth owns signup/login reconciliation on every load, including sessions
        // already resolved by SSR.
        if (!this.applySession(response)) return;

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
        const callbackPath = useLocalePath()('/user/settings');
        await useNadeshikoSdk().changeEmail({
          newEmail,
          callbackURL: `${window.location.origin}${callbackPath}`,
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
