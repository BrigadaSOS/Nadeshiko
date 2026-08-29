import { describe, test, expect, beforeEach, vi } from 'vitest';
import { reactive } from 'vue';

/**
 * Telling PostHog who a reader is, and reporting the signup or login when this
 * page load is where that changed.
 *
 * `utils/authAnalytics` covers the pure decisions -- what counts as a signup, how
 * a lost session is aged. This covers the ORCHESTRATION, which is where the
 * expensive mistakes have been:
 *
 * IT RUNS ON EVERY LOAD, not only on a callback. The previous implementation
 * asked better-auth's OAuth redirect for `code`/`state` parameters it does not
 * send, so in 90 days it recorded 70 magic-link logins and not one Google or
 * Discord login, out of 264 Google attempts.
 *
 * A SIGNED-OUT READER IS NOT NOTHING TO REPORT. Someone whose session ended
 * without them asking arrives looking exactly like a first-time visitor, and
 * until `session_lost` existed that is what they were counted as -- which is how
 * sessions could stop being renewed for everyone, for a month, with nothing
 * anywhere to say so.
 *
 * AN IMPERSONATING ADMIN IS NOT THE PERSON THEY ARE LOOKING AT. Identifying them
 * would write the admin's browsing onto that reader's person and report a login
 * they never performed.
 */
const posthog = {
  identify: vi.fn(),
  capture: vi.fn(),
  reset: vi.fn(),
  get_distinct_id: vi.fn(() => 'anon-1'),
  get_property: vi.fn(() => undefined as unknown),
};

/** `onPostHogReady` runs its callback once the SDK lands; here, at once. */
vi.mock('~/utils/posthogClient', () => ({
  onPostHogReady: (fn: (client: unknown) => void) => fn(posthog),
}));

const user = reactive({
  isLoggedIn: false,
  isImpersonating: false,
  userId: null as string | null,
  userName: null as string | null,
  userEmail: null as string | null,
  userCreatedAt: null as string | null,
  sessionId: null as string | null,
  sessionCreatedAt: null as string | null,
  userInfo: { role: 'USER' },
});
vi.stubGlobal('userStore', () => user);
vi.stubGlobal('usePostHog', () => posthog);

import {
  ANALYTICS_DELIBERATE_SIGN_OUT_KEY,
  ANALYTICS_IDENTITY_KEY,
  ANALYTICS_SESSION_KEY,
  ANALYTICS_SESSION_STARTED_KEY,
} from '~/utils/authAnalytics';

/** Re-imports, because a "reported this page load" guard lives at module scope. */
async function loadComposable() {
  vi.resetModules();
  return (await import('./useAnalyticsIdentity')).reconcileAnalyticsIdentity;
}

/** Puts the browser on a page, which is where the arrival details are read from. */
function arriveAt({ search = '', referrer = '' } = {}) {
  vi.stubGlobal('document', { referrer });
  vi.stubGlobal('window', {
    location: { search, pathname: '/en', hostname: 'nadeshiko.co', href: `https://nadeshiko.co/en${search}` },
    localStorage,
  });
}

/** Signs a reader in, with a session this browser has not reported yet. */
function signedIn(overrides: Partial<typeof user> = {}) {
  Object.assign(user, {
    isLoggedIn: true,
    isImpersonating: false,
    userId: 'user-1',
    userName: 'Reader',
    userEmail: 'reader@example.com',
    userCreatedAt: '2020-01-01T00:00:00.000Z',
    sessionId: 'session-1',
    sessionCreatedAt: new Date().toISOString(),
    ...overrides,
  });
}

/** The names of the events captured so far. */
function captured() {
  return posthog.capture.mock.calls.map(([name]) => name);
}

beforeEach(() => {
  vi.clearAllMocks();
  posthog.get_distinct_id.mockReturnValue('anon-1');
  posthog.get_property.mockReturnValue(undefined);
  localStorage.clear();
  Object.assign(user, {
    isLoggedIn: false,
    isImpersonating: false,
    userId: null,
    userName: null,
    userEmail: null,
    userCreatedAt: null,
    sessionId: null,
    sessionCreatedAt: null,
  });
  arriveAt();
});

describe('a signed-in reader', () => {
  test('is identified by their account id', async () => {
    // Not by display name: `username` has no unique constraint, so two people
    // sharing one would share a PostHog person.
    signedIn();

    (await loadComposable())({ viaCallback: false });

    expect(posthog.identify).toHaveBeenCalledWith('user-1', expect.any(Object), expect.any(Object));
  });

  test('is identified BEFORE anything is captured', async () => {
    // So the events land on the identified person and this browser's anonymous
    // history merges into it rather than being stranded.
    const order: string[] = [];
    posthog.identify.mockImplementation(() => order.push('identify'));
    posthog.capture.mockImplementation(() => order.push('capture'));
    signedIn();

    (await loadComposable())({ viaCallback: true });

    expect(order[0]).toBe('identify');
  });

  test('records a login this browser has not seen before', async () => {
    signedIn();

    (await loadComposable())({ viaCallback: true });

    expect(captured()).toContain('user_logged_in');
  });

  test('records a SIGNUP for an account created moments ago', async () => {
    signedIn({ userCreatedAt: new Date().toISOString() });

    (await loadComposable())({ viaCallback: true });

    expect(captured()).toContain('signup_completed');
  });

  test('remembers who it reported, so the next load is quiet', async () => {
    signedIn();
    const reconcile = await loadComposable();
    reconcile({ viaCallback: true });
    posthog.capture.mockClear();

    (await loadComposable())({ viaCallback: true });

    expect(captured()).toEqual([]);
  });

  test('reports once per page load, however many plugins ask', async () => {
    // `identity-auth` reconciles on every load and `auth-callback` reconciles
    // again once it knows the load was an auth landing.
    signedIn();
    const reconcile = await loadComposable();

    reconcile({ viaCallback: true });
    reconcile({ viaCallback: true });

    expect(captured().filter((name) => name === 'user_logged_in')).toHaveLength(1);
  });

  test('records when the session began, so its age is known after it is gone', async () => {
    // Written on every load rather than only on a transition: a reader already
    // signed in when this shipped would otherwise have their eventual sign-out
    // reported ageless.
    const startedAt = '2026-08-01T00:00:00.000Z';
    signedIn({ sessionCreatedAt: startedAt });

    (await loadComposable())({ viaCallback: false });

    expect(localStorage.getItem(ANALYTICS_SESSION_STARTED_KEY)).toBe(String(Date.parse(startedAt)));
  });

  test('ignores a session start that will not parse', async () => {
    signedIn({ sessionCreatedAt: 'not a date' });

    (await loadComposable())({ viaCallback: false });

    expect(localStorage.getItem(ANALYTICS_SESSION_STARTED_KEY)).toBeNull();
  });
});

describe('an impersonating admin', () => {
  test('is not identified as the person they are looking at', async () => {
    // It would write the admin's browsing onto that reader's person.
    signedIn({ isImpersonating: true });

    (await loadComposable())({ viaCallback: true });

    expect(posthog.identify).not.toHaveBeenCalled();
  });

  test('does not report a login the reader never performed', async () => {
    signedIn({ isImpersonating: true });

    (await loadComposable())({ viaCallback: true });

    expect(captured()).toEqual([]);
  });
});

describe('a reader whose session has gone', () => {
  /** This browser reported a session that started `hoursAgo`. */
  function hadSessionSince(hoursAgo: number) {
    localStorage.setItem(ANALYTICS_IDENTITY_KEY, 'user-1');
    localStorage.setItem(ANALYTICS_SESSION_KEY, 'session-1');
    localStorage.setItem(ANALYTICS_SESSION_STARTED_KEY, String(Date.now() - hoursAgo * 60 * 60 * 1000));
  }

  test('is reported as a lost session, not as a first-time visitor', async () => {
    // Until this branch existed, sessions could stop being renewed for
    // everyone, for a month, with nothing anywhere to say so.
    hadSessionSince(30);

    (await loadComposable())({ viaCallback: false });

    expect(captured()).toContain('session_lost');
  });

  test('carries how long they had been signed in, which is what names the horizon', async () => {
    // Everything a person chooses to do is spread across the range; only a
    // mechanical expiry piles up on one value.
    hadSessionSince(24);

    (await loadComposable())({ viaCallback: false });

    const [, properties] = posthog.capture.mock.calls.find(([name]) => name === 'session_lost')!;
    expect(properties.hours_signed_in).toBeGreaterThanOrEqual(23);
  });

  test('is NOT reported when the reader signed out on purpose', async () => {
    hadSessionSince(30);
    localStorage.setItem(ANALYTICS_DELIBERATE_SIGN_OUT_KEY, String(Date.now()));

    (await loadComposable())({ viaCallback: false });

    expect(captured()).not.toContain('session_lost');
  });

  test('clears the deliberate-sign-out marker whether or not anything was reported', async () => {
    // It answers "since the last load", and leaving it set would silence the
    // next genuine loss.
    hadSessionSince(30);
    localStorage.setItem(ANALYTICS_DELIBERATE_SIGN_OUT_KEY, String(Date.now()));

    (await loadComposable())({ viaCallback: false });

    expect(localStorage.getItem(ANALYTICS_DELIBERATE_SIGN_OUT_KEY)).toBeNull();
  });

  test('forgets the identity, so it fires once rather than on every load after', async () => {
    hadSessionSince(30);
    const reconcile = await loadComposable();
    reconcile({ viaCallback: false });
    posthog.capture.mockClear();

    (await loadComposable())({ viaCallback: false });

    expect(captured()).not.toContain('session_lost');
  });

  test('says nothing about a browser that was never signed in here', async () => {
    // An ordinary first-time visitor.
    (await loadComposable())({ viaCallback: false });

    expect(captured()).toEqual([]);
    expect(posthog.identify).not.toHaveBeenCalled();
  });
});

describe('the legacy display-name identity', () => {
  test('is released so the account id can take over', async () => {
    // posthog-js refuses to re-identify: without this, every reader signed in
    // at the time of the switch would stay keyed on their display name for
    // ever, on exactly the readers who already existed.
    posthog.get_distinct_id.mockReturnValue('Reader');
    signedIn({ userName: 'Reader' });

    (await loadComposable())({ viaCallback: true });

    expect(posthog.reset).toHaveBeenCalled();
    expect(posthog.identify).toHaveBeenCalledWith('user-1', expect.anything(), expect.anything());
  });

  test('a migration is recorded WITHOUT an event', async () => {
    // This browser's reader did not just sign in, they were re-keyed
    // underneath; counting it would put ~200 one-off migrations into the login
    // numbers.
    posthog.get_distinct_id.mockReturnValue('Reader');
    signedIn({ userName: 'Reader' });

    (await loadComposable())({ viaCallback: true });

    expect(captured()).toEqual([]);
    expect(localStorage.getItem(ANALYTICS_IDENTITY_KEY)).toBe('user-1');
  });

  test('an ANONYMOUS reader is never reset', async () => {
    // Their history is precisely what `identify` is about to merge into the
    // account, and it is the pre-signup half of every attribution question.
    posthog.get_distinct_id.mockReturnValue('01234567-89ab-cdef-0123-456789abcdef');
    signedIn({ userName: 'Reader' });

    (await loadComposable())({ viaCallback: true });

    expect(posthog.reset).not.toHaveBeenCalled();
  });

  test('a reader already on their account id is not reset again', async () => {
    // The early return keeps this to genuinely once per browser.
    posthog.get_distinct_id.mockReturnValue('user-1');
    signedIn();

    (await loadComposable())({ viaCallback: true });

    expect(posthog.reset).not.toHaveBeenCalled();
  });
});

describe('the arrival details', () => {
  test('are read at once rather than when the SDK lands', async () => {
    // `auth-callback` strips the query at `app:mounted`, and on a cold load --
    // which a magic link opened from an inbox always is -- that happens BEFORE
    // the SDK arrives. Reading it later would lose the intent the sign-in
    // travelled with, which is its whole attribution.
    let fire: (() => void) | null = null;
    vi.doMock('~/utils/posthogClient', () => ({
      onPostHogReady: (fn: (client: unknown) => void) => {
        fire = () => fn(posthog);
      },
    }));
    arriveAt({ search: '?nd_intent=save-search' });
    signedIn();
    vi.resetModules();
    const reconcile = (await import('./useAnalyticsIdentity')).reconcileAnalyticsIdentity;

    reconcile({ viaCallback: true });
    // The query is gone by the time the SDK answers, as it is in a real load.
    arriveAt({ search: '' });
    fire!();

    expect(captured()).toContain('user_logged_in');
    vi.doUnmock('~/utils/posthogClient');
  });
});
