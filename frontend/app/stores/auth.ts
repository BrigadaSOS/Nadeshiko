import { useNuxtApp } from '#app';
import type { UserPreferences } from '@brigadasos/nadeshiko-sdk';
import { defineStore } from 'pinia';
import { setReaderStack } from '~/utils/wordLookup';
import { handleApiError } from '~/utils/apiError';
import {
  ANALYTICS_DELIBERATE_SIGN_OUT_KEY,
  AUTH_CALLBACK_PARAM,
  authIntentStorage,
  readAuthIntent,
  withAuthCallbackMarker,
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
  /**
   * The account's primary key. Immutable and unique, unlike `name`, which is
   * neither -- which is why this is what PostHog is keyed on.
   */
  id?: string | null;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  createdAt?: string | null;
  /**
   * The reader's linked Shirabe account, folded onto the session by the backend
   * because the word card needs it on every render.
   *
   * `stackFingerprint` names the dictionary stack their lookups are answered
   * from. It rides here so a lookup URL can carry it: a linked reader's word
   * cards are cached in this browser for a day, and this is the only thing in
   * the request that moves when they reconfigure their dictionaries in Shirabe.
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
   * When the session began, from the server rather than from anything this
   * browser remembers. It is what lets an involuntary sign-out be reported with
   * the session's age attached -- and the age is the whole diagnostic, because a
   * mechanical expiry lands on the same number every time and nothing a reader
   * does by choice ever does.
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

      try {
        const response = await useNadeshikoSdk().socialSignIn({
          // Marked so the landing page can tell "just signed in" from "reloaded a
          // page while signed in". better-auth returns the reader to this URL
          // verbatim, with none of the `code`/`state` parameters the callback
          // plugin used to look for -- which is why no OAuth login was ever
          // recorded before this marker existed.
          callbackURL: withAuthCallbackMarker(window.location.href),
          errorCallbackURL: withAuthCallbackMarker(window.location.href),
          provider,
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
        // `magic_callback` is kept alongside the shared marker so links already
        // sitting in an inbox still land on a page that knows what they are.
        //
        // The intent rides along in the link because this is the one flow that can
        // finish on a different device: mailed to a phone, opened on a laptop whose
        // storage has never seen the modal. The parked copy still wins on arrival
        // when there is one -- these parameters are the fallback.
        const callbackURL = withAuthIntentParams(
          `/?magic_callback=1&${AUTH_CALLBACK_PARAM}=1`,
          readAuthIntent(authIntentStorage(), Date.now()),
        );
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
        // Marks this sign-out as the reader's own doing, so the next load does
        // not report it as a session they lost. See `reportLostSession`.
        writeStoredValue(authIntentStorage(), ANALYTICS_DELIBERATE_SIGN_OUT_KEY, String(Date.now()));
        // Drops the identity so the next visitor on this browser is anonymous
        // again. Deliberately does NOT clear `ANALYTICS_IDENTITY_KEY`: that record
        // is what stops a sign-out and straight-back-in, inside the five minutes
        // an account still counts as new, from reporting a second signup for an
        // account that was only ever created once.
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
        // Signup and login are no longer reported from here. This branch only ran
        // when the client had to re-ask for the session, and after an auth round
        // trip the SSR pass has already resolved it from the cookie -- so the one
        // moment it was meant to catch was the one moment it could not run, and
        // `signup_completed` fired 3 times in 180 days. `identity-auth` now
        // reconciles identity on every load instead, where the answer is known.
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
