import { describe, test, expect, beforeEach, vi } from 'vitest';

/**
 * The auth store, which decides two things nothing else can recover from.
 *
 * ONE: what "signed in" means. `applySession` is the single mapping both entry
 * points share -- the SSR plugin reading the cookie and the client re-reading
 * after a login -- and it exists as one function precisely because it used to be
 * spelled out twice, so a field added to the session was picked up on one path
 * and not the other and the server-rendered page disagreed with the hydrated app
 * about who was signed in.
 *
 * TWO: when a reader is signed OUT. Only a 401 may do that. A backend 5xx, a
 * network blip or a rate limit that logs somebody out looks to them like being
 * randomly kicked, and the same mistake in the Anki store produced 49 error
 * reports in one sitting from a single reader.
 */
const sdk = {
  getSession: vi.fn(),
  getUserPreferences: vi.fn().mockResolvedValue({}),
  socialSignIn: vi.fn(),
  signInWithMagicLink: vi.fn(),
  signInWithEmailOtp: vi.fn(),
  signOut: vi.fn().mockResolvedValue({}),
  impersonateUser: vi.fn().mockResolvedValue({}),
  authAdminStopImpersonating: vi.fn().mockResolvedValue({}),
};
const posthog = { capture: vi.fn(), reset: vi.fn() };
const toasts = { error: vi.fn(), success: vi.fn() };
const router = { currentRoute: { value: { path: '/en/search' } }, push: vi.fn() };

const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));

const setReaderStack = vi.fn();
vi.mock('~/utils/wordLookup', () => ({ setReaderStack: (...a: unknown[]) => setReaderStack(...a) }));

vi.stubGlobal('useNadeshikoSdk', () => sdk);
vi.stubGlobal('usePostHog', () => posthog);
vi.stubGlobal('useRouter', () => router);
vi.stubGlobal('useLocalePath', () => (path: string) => `/en${path === '/' ? '' : path}`);
vi.stubGlobal('useNuxtApp', () => ({ $i18n: { locale: { value: 'en' }, t: (key: string) => key } }));
vi.stubGlobal('useToastError', (...a: unknown[]) => toasts.error(...a));
vi.stubGlobal('useToastSuccess', (...a: unknown[]) => toasts.success(...a));
vi.stubGlobal('window', { location: { href: 'https://nadeshiko.co/en/search' } });

import { userStore } from './auth';
import { MAGIC_LINK_HOLD_BACKS } from '~/utils/magicLinkHoldBack';

/**
 * A better-auth session as the backend returns it, enriched by `customSession`.
 *
 * The ids are NUMBERS here while `SessionUser` declares them as strings, and
 * that is the point rather than an oversight: better-auth's generated schema has
 * already proved not to describe this deployment exactly (see
 * `SCHEMA_CORRECTIONS` in `generateAuthSpec.ts`), and `applySession` stringifies
 * both defensively. The cast is what lets the test exercise that, and dropping
 * it would leave the defence untested.
 */
type SessionResponse = Parameters<ReturnType<typeof userStore>['applySession']>[0];

function session(overrides: { user?: Record<string, unknown>; session?: Record<string, unknown> } = {}) {
  return {
    user: {
      id: 42,
      name: 'Reader',
      email: 'reader@example.com',
      role: 'USER',
      createdAt: '2026-01-01T00:00:00.000Z',
      ...overrides.user,
    },
    session: { id: 7, token: 'tok-1', createdAt: '2026-08-01T00:00:00.000Z', ...overrides.session },
  } as unknown as SessionResponse;
}

/** An error shaped like one the SDK throws for `status`. */
function httpError(status: number, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`HTTP ${status}`), { status, ...extra });
}

beforeEach(() => {
  vi.clearAllMocks();
  sdk.getUserPreferences.mockResolvedValue({});
  sdk.signOut.mockResolvedValue({});
  router.currentRoute.value = { path: '/en/search' };
});

describe('applySession', () => {
  test('a session signs the reader in', () => {
    const store = userStore();

    expect(store.applySession(session())).toBe(true);
    expect(store.isLoggedIn).toBe(true);
  });

  test('maps every field both entry points depend on', () => {
    // Spelled out rather than spot-checked: this mapping existing once is the
    // whole reason the function exists, and a field silently missing from it is
    // how SSR and hydration came to disagree.
    const store = userStore();

    store.applySession(session());

    expect(store).toMatchObject({
      userId: '42',
      sessionId: '7',
      userName: 'Reader',
      userEmail: 'reader@example.com',
      currentSessionToken: 'tok-1',
      userCreatedAt: '2026-01-01T00:00:00.000Z',
      sessionCreatedAt: '2026-08-01T00:00:00.000Z',
      userInfo: { role: 'USER' },
    });
  });

  test('stringifies numeric ids, because PostHog and the cache key on strings', () => {
    const store = userStore();

    store.applySession(session({ user: { id: 42 }, session: { id: 7 } }));

    expect(store.userId).toBe('42');
    expect(store.sessionId).toBe('7');
  });

  test('a session with no role at all defaults to USER, never to nothing', () => {
    // `isAdmin` reads this. An undefined role in a truthiness check elsewhere is
    // how a privilege test goes wrong quietly.
    const store = userStore();

    store.applySession(session({ user: { role: null } }));

    expect(store.userInfo.role).toBe('USER');
  });

  test('an empty response signs the reader out', () => {
    const store = userStore();
    store.applySession(session());

    expect(store.applySession(null)).toBe(false);
    expect(store.isLoggedIn).toBe(false);
  });

  test('a response with neither user nor session signs them out', () => {
    const store = userStore();
    store.applySession(session());

    expect(store.applySession({ user: null, session: null })).toBe(false);
    expect(store.isLoggedIn).toBe(false);
  });

  test('pushes the reader’s dictionary stack to the word-lookup cache', () => {
    // The cache keys on this and cannot reach in for it, so this is the one
    // place that knows a session landed and has to push.
    const store = userStore();

    store.applySession(session({ user: { shirabe: { linked: true, stackFingerprint: 'fp-1' } } }));

    expect(store.shirabeStackFingerprint).toBe('fp-1');
    expect(setReaderStack).toHaveBeenCalledWith('fp-1');
  });

  test('clears the stack when signing out, so the next reader is not served the last one’s cards', () => {
    const store = userStore();
    store.applySession(session({ user: { shirabe: { linked: true, stackFingerprint: 'fp-1' } } }));

    store.applySession(null);

    expect(setReaderStack).toHaveBeenLastCalledWith(null);
  });

  test('a reader with no Shirabe account is not marked linked', () => {
    const store = userStore();

    store.applySession(session({ user: { shirabe: null } }));

    expect(store.shirabeLinked).toBe(false);
    expect(store.shirabeGlossLanguages).toEqual([]);
  });

  test('records the gloss languages in the order the stack gives them', () => {
    // `jmdict:es` above `jmdict:en` means Spanish first, and the order is the
    // information.
    const store = userStore();

    store.applySession(session({ user: { shirabe: { linked: true, glossLanguages: ['es', 'en'] } } }));

    expect(store.shirabeGlossLanguages).toEqual(['es', 'en']);
  });

  test('an impersonated session is marked as one, naming who is being impersonated', () => {
    const store = userStore();

    store.applySession(session({ user: { name: 'Target' }, session: { impersonatedBy: 'admin-1' } }));

    expect(store.isImpersonating).toBe(true);
    expect(store.impersonatedUsername).toBe('Target');
  });

  test('an ordinary session is not marked as impersonation', () => {
    const store = userStore();

    store.applySession(session());

    expect(store.isImpersonating).toBe(false);
    expect(store.impersonatedUsername).toBeNull();
  });
});

describe('isAdmin', () => {
  test.each([
    ['ADMIN', true],
    ['MOD', false],
    ['USER', false],
    ['PATREON', false],
  ])('%s is admin: %s', (role, expected) => {
    const store = userStore();

    store.applySession(session({ user: { role } }));

    expect(store.isAdmin).toBe(expected);
  });

  test('a signed-out visitor is not an admin', () => {
    expect(userStore().isAdmin).toBe(false);
  });
});

describe('getBasicInfo', () => {
  test('applies the session and loads preferences', async () => {
    sdk.getSession.mockResolvedValue(session());
    sdk.getUserPreferences.mockResolvedValue({ mediaNameLanguage: 'JAPANESE' });
    const store = userStore();

    await store.getBasicInfo();

    expect(store.isLoggedIn).toBe(true);
    expect(store.preferences).toEqual({ mediaNameLanguage: 'JAPANESE' });
  });

  test('does not ask for preferences when there is no session to hang them on', async () => {
    sdk.getSession.mockResolvedValue(null);

    await userStore().getBasicInfo();

    expect(sdk.getUserPreferences).not.toHaveBeenCalled();
  });

  test('a session survives preferences failing to load', async () => {
    // Preferences are additive: every reader falls back to a default, so losing
    // them must not cost the session.
    sdk.getSession.mockResolvedValue(session());
    sdk.getUserPreferences.mockRejectedValue(httpError(500));
    const store = userStore();

    await store.getBasicInfo();

    expect(store.isLoggedIn).toBe(true);
    expect(store.preferences).toEqual({});
  });

  test('a 401 signs the reader out, because the session really is gone', async () => {
    sdk.getSession.mockRejectedValue(httpError(401));
    const store = userStore();
    store.applySession(session());

    await store.getBasicInfo();

    expect(store.isLoggedIn).toBe(false);
  });

  test.each([500, 502, 429, 0])('a %d keeps the session, since it says nothing about it', async (status) => {
    sdk.getSession.mockRejectedValue(httpError(status));
    const store = userStore();
    store.applySession(session());

    await store.getBasicInfo();

    expect(store.isLoggedIn).toBe(true);
  });

  test('records which way it went, so the two are tellable apart in reports', async () => {
    sdk.getSession.mockRejectedValue(httpError(500));

    await userStore().getBasicInfo();

    expect(handleApiError).toHaveBeenCalledWith(
      'auth:session-fetch-failed',
      expect.anything(),
      expect.objectContaining({ context: { recovered: 'kept-session' } }),
    );
  });

  test('reads the status off a nested response when that is where it is', async () => {
    // The SDK does not always flatten it, and reading only `error.status` would
    // treat a real 401 as a keep-the-session failure.
    sdk.getSession.mockRejectedValue({ response: { status: 401 } });
    const store = userStore();
    store.applySession(session());

    await store.getBasicInfo();

    expect(store.isLoggedIn).toBe(false);
  });
});

describe('sendMagicLink', () => {
  test('reports success when the mail went out', async () => {
    sdk.signInWithMagicLink.mockResolvedValue({});

    expect(await userStore().sendMagicLink('reader@example.com')).toEqual({ status: 'ok' });
  });

  test('a rate limit is a countdown, not an apology', async () => {
    // "We did not send one" has two very different meanings, and the modal
    // renders them differently.
    sdk.signInWithMagicLink.mockRejectedValue(httpError(429, { retryAfterSeconds: 120 }));

    expect(await userStore().sendMagicLink('reader@example.com')).toEqual({
      status: 'rate-limited',
      retryAfterSeconds: 120,
    });
  });

  test('a 429 with no Retry-After still produces a wait', async () => {
    // Zero would render a button that invites an immediate second refusal.
    sdk.signInWithMagicLink.mockRejectedValue(httpError(429));

    expect(await userStore().sendMagicLink('reader@example.com')).toEqual({
      status: 'rate-limited',
      retryAfterSeconds: MAGIC_LINK_HOLD_BACKS[0],
    });
  });

  test('any other failure is a plain failure', async () => {
    sdk.signInWithMagicLink.mockRejectedValue(httpError(500));

    expect(await userStore().sendMagicLink('reader@example.com')).toEqual({ status: 'failed' });
  });

  test('never raises a toast -- the modal renders the failure inline', async () => {
    sdk.signInWithMagicLink.mockRejectedValue(httpError(500));

    await userStore().sendMagicLink('reader@example.com');

    expect(handleApiError.mock.calls[0]![2]).toMatchObject({ toastKey: false });
    expect(toasts.error).not.toHaveBeenCalled();
  });
});

describe('signInWithCode', () => {
  test('signs the reader in on a good code', async () => {
    sdk.signInWithEmailOtp.mockResolvedValue({});
    sdk.getSession.mockResolvedValue(session());
    const store = userStore();

    expect(await store.signInWithCode('reader@example.com', '123456')).toBe('ok');
    expect(store.isLoggedIn).toBe(true);
  });

  test('names the wrong-browser case, which retrying will never fix', async () => {
    // The backend leaves a sealed cookie when the mail goes out and refuses a
    // code without a matching one -- that is what lets the code be six
    // characters. "Try again" is the wrong advice here.
    sdk.signInWithEmailOtp.mockRejectedValue(httpError(400, { data: { code: 'LOGIN_CODE_NOT_BOUND' } }));

    expect(await userStore().signInWithCode('reader@example.com', '123456')).toBe('wrong-browser');
  });

  test('a plain wrong code is worth trying again', async () => {
    sdk.signInWithEmailOtp.mockRejectedValue(httpError(400, { data: { code: 'INVALID_OTP' } }));

    expect(await userStore().signInWithCode('reader@example.com', '000000')).toBe('failed');
  });

  test('a 400 with no detail is not mistaken for the wrong browser', async () => {
    sdk.signInWithEmailOtp.mockRejectedValue(httpError(400));

    expect(await userStore().signInWithCode('reader@example.com', '000000')).toBe('failed');
  });
});

describe('loginWithProvider', () => {
  test('sends the reader to the provider', async () => {
    sdk.socialSignIn.mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/auth' });

    await userStore().loginGoogle();

    expect(window.location.href).toBe('https://accounts.google.com/o/oauth2/auth');
  });

  test('marks the callback URL, which is what makes an OAuth login countable', async () => {
    // Without the marker the landing page cannot tell "just signed in" from
    // "reloaded a page while signed in", and no OAuth login was ever recorded.
    sdk.socialSignIn.mockResolvedValue({ url: 'https://example.test' });

    await userStore().loginDiscord();

    const { callbackURL, errorCallbackURL, provider } = sdk.socialSignIn.mock.calls[0]![0];
    expect(provider).toBe('discord');
    expect(callbackURL).not.toBe('https://nadeshiko.co/en/search');
    expect(errorCallbackURL).toBe(callbackURL);
  });

  test('shows an error rather than navigating when the provider declined', async () => {
    sdk.socialSignIn.mockResolvedValue({ error: { message: 'nope' } });
    window.location.href = 'https://nadeshiko.co/en/search';

    await userStore().loginGoogle();

    expect(toasts.error).toHaveBeenCalled();
    expect(window.location.href).toBe('https://nadeshiko.co/en/search');
  });

  test('reports a thrown failure with the provider that failed', async () => {
    sdk.socialSignIn.mockRejectedValue(httpError(500));

    await userStore().loginGoogle();

    expect(handleApiError).toHaveBeenCalledWith(
      'auth:social-login-failed',
      expect.anything(),
      expect.objectContaining({ context: { provider: 'google' } }),
    );
  });
});

describe('logout', () => {
  test('clears auth state', async () => {
    const store = userStore();
    store.applySession(session());

    await store.logout();

    expect(store.isLoggedIn).toBe(false);
  });

  test('clears auth state even when the sign-out call failed', async () => {
    // The cookie may already be gone. Leaving the client believing it is signed
    // in is worse than a server that never heard about it.
    sdk.signOut.mockRejectedValue(httpError(500));
    const store = userStore();
    store.applySession(session());

    await store.logout();

    expect(store.isLoggedIn).toBe(false);
    expect(handleApiError).toHaveBeenCalledWith('auth:sign-out-failed', expect.anything(), { toastKey: false });
  });

  test('drops the analytics identity, so the next visitor on this browser is anonymous', async () => {
    await userStore().logout();

    expect(posthog.reset).toHaveBeenCalled();
    expect(posthog.capture).toHaveBeenCalledWith('user_logged_out');
  });

  test('stays on the page the reader was on', async () => {
    // Signing out is not a request to go somewhere else, and most of the site
    // is public.
    router.currentRoute.value = { path: '/en/media/oshi-no-ko' };

    await userStore().logout();

    expect(router.push).not.toHaveBeenCalled();
  });

  test.each(['/en/user', '/en/user/settings', '/user'])('leaves %s, which needs an account', async (path) => {
    // Its guard would bounce an anonymous visitor anyway; going now avoids a
    // redirect flash.
    router.currentRoute.value = { path };

    await userStore().logout();

    expect(router.push).toHaveBeenCalled();
  });

  test('does not mistake a public path that merely starts with the same letters', async () => {
    router.currentRoute.value = { path: '/en/users-guide' };

    await userStore().logout();

    expect(router.push).not.toHaveBeenCalled();
  });

  test('shows the caller’s own message when it gave one', async () => {
    await userStore().logout('session expired');

    expect(toasts.success).toHaveBeenCalledWith('session expired');
  });
});

describe('impersonation', () => {
  test('switches to the target and confirms it', async () => {
    sdk.getSession.mockResolvedValue(session({ session: { impersonatedBy: 'admin-1' } }));
    const store = userStore();

    await store.impersonateUser(99);

    expect(sdk.impersonateUser).toHaveBeenCalledWith({ userId: 99 });
    expect(store.isImpersonating).toBe(true);
    expect(toasts.success).toHaveBeenCalled();
  });

  test('a failed switch is reported and does not leave the admin impersonating', async () => {
    sdk.impersonateUser.mockRejectedValue(httpError(403));
    const store = userStore();

    await store.impersonateUser(99);

    expect(store.isImpersonating).toBe(false);
    expect(handleApiError).toHaveBeenCalledWith('auth:impersonate-failed', expect.anything(), expect.anything());
  });

  test('stopping returns to the home page', async () => {
    sdk.getSession.mockResolvedValue(session());

    await userStore().stopImpersonating();

    expect(window.location.href).toBe('/');
  });

  test('stopping returns home even when the call failed, rather than stranding the admin', async () => {
    sdk.authAdminStopImpersonating.mockRejectedValue(httpError(500));
    const store = userStore();
    store.applySession(session({ session: { impersonatedBy: 'admin-1' } }));

    await store.stopImpersonating();

    expect(store.isLoggedIn).toBe(false);
    expect(window.location.href).toBe('/');
  });
});
