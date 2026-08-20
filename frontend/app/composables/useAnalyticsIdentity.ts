import {
  ANALYTICS_DELIBERATE_SIGN_OUT_KEY,
  ANALYTICS_IDENTITY_KEY,
  ANALYTICS_SESSION_KEY,
  ANALYTICS_SESSION_STARTED_KEY,
  absorbIntentFromUrl,
  acquisitionSetOnce,
  authEventProperties,
  authIntentStorage,
  consumeAuthIntent,
  readStoredValue,
  removeStoredValue,
  resolveAuthTransition,
  resolveLostSession,
  writeStoredValue,
} from '~/utils/authAnalytics';

/**
 * Guards against the two plugins that call this both reporting the same
 * transition. `identity-auth` reconciles on every load and `auth-callback`
 * reconciles again once it knows the load was an auth landing; whichever gets
 * there first with an answer wins, and the other becomes a no-op.
 *
 * Module scope, so it lives for the page load rather than the component -- which
 * is the right lifetime: an auth transition happens once per navigation to the
 * callback URL, and every real one arrives on a fresh document.
 */
let reportedThisPageLoad = false;

const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'icloud.com',
  'me.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'proton.me',
  'protonmail.com',
  'yahoo.com',
]);

/**
 * Tells PostHog who this is, and reports the signup or login if this page load is
 * where that changed.
 *
 * Called on every client load rather than only on a callback, because the things
 * being compared -- the account and the session in play against the ones this
 * browser last reported -- need no cooperation from the auth provider. That
 * matters: the previous implementation asked better-auth's OAuth redirect for
 * `code`/`state` parameters it does not send, so in 90 days it recorded 70
 * magic-link logins and not one Google or Discord login, out of 264 Google
 * attempts.
 */
export function reconcileAnalyticsIdentity(options: { viaCallback: boolean }) {
  if (!import.meta.client) return;

  const store = userStore();
  const posthog = usePostHog();
  if (!posthog) return;

  // Signed out, which is not the same as "nothing to report". A reader whose
  // session ended without them asking arrives here looking exactly like a
  // first-time visitor, and until this branch existed that is precisely what
  // they were counted as -- which is how sessions could stop being renewed for
  // everyone, for a month at a time, with nothing anywhere to say so.
  if (!store.isLoggedIn || !store.userId) {
    reportLostSession(posthog);
    return;
  }

  // An admin looking through someone else's account is not that person. Without
  // this, impersonation would identify the admin's browser as the target user and
  // write the admin's browsing onto their person -- and, now that a new session id
  // means a real sign-in, would report a login they never performed.
  if (store.isImpersonating) return;

  const now = Date.now();
  const storage = authIntentStorage();
  const userId = store.userId;

  // Before anything reads the intent: a magic link may have arrived on a device
  // that never saw the modal, carrying its attribution in the URL instead.
  absorbIntentFromUrl(storage, window.location.search, now);

  const storedUserId = readStoredValue(storage, ANALYTICS_IDENTITY_KEY);
  const storedSessionId = readStoredValue(storage, ANALYTICS_SESSION_KEY);
  const migratedFromLegacyKey = releaseLegacyIdentity(posthog, userId, store.userName);

  // Ahead of any capture below, so the events land on the identified person and
  // this browser's anonymous history merges into it rather than being stranded.
  posthog.identify(userId, currentPersonProperties(store), { account_created_at: store.userCreatedAt ?? undefined });

  const remember = () => {
    writeStoredValue(storage, ANALYTICS_IDENTITY_KEY, userId);
    if (store.sessionId) writeStoredValue(storage, ANALYTICS_SESSION_KEY, store.sessionId);
  };

  // Outside `remember()` on purpose: that only runs on a transition, so a reader
  // already signed in when this shipped would never get a start time and their
  // eventual sign-out would be reported ageless. Written on every load instead,
  // and only when it actually moves, which is once per session.
  rememberSessionStart(storage, store.sessionCreatedAt);

  if (migratedFromLegacyKey) {
    // This browser's reader did not just sign in, they were re-keyed underneath.
    // Recording it without an event keeps ~200 one-off migrations out of the login
    // numbers, at the cost of not counting the session they happened to be in --
    // the cheaper of the two inaccuracies.
    remember();
    return;
  }

  const transition = resolveAuthTransition({
    currentUserId: userId,
    storedUserId,
    currentSessionId: store.sessionId ?? null,
    storedSessionId,
    accountCreatedAt: store.userCreatedAt ?? null,
    now,
    viaCallback: options.viaCallback,
  });

  if (!transition || reportedThisPageLoad) return;
  reportedThisPageLoad = true;
  remember();

  const properties = authEventProperties(consumeAuthIntent(storage, now));

  posthog.capture(transition, {
    ...properties,
    // Only on the signup, and only ever written once: this is what the account was
    // created *for*, and a later login from the header must not overwrite it.
    // Recording it on the person as well as the event is what lets a retention or
    // engagement question be broken down by acquisition gate later, without
    // re-deriving it from the event stream every time.
    ...(transition === 'signup_completed' ? acquisitionSetOnce(properties) : {}),
  });
}

/**
 * Records when the current session began, so its age is known after it is gone.
 */
function rememberSessionStart(storage: ReturnType<typeof authIntentStorage>, sessionCreatedAt: string | null): void {
  if (!sessionCreatedAt) return;

  const startedAt = Date.parse(sessionCreatedAt);
  if (!Number.isFinite(startedAt)) return;

  const stored = String(startedAt);
  if (readStoredValue(storage, ANALYTICS_SESSION_STARTED_KEY) === stored) return;

  writeStoredValue(storage, ANALYTICS_SESSION_STARTED_KEY, stored);
}

/**
 * Reports a session this browser lost without being asked, once.
 *
 * `session_lost` says what was observed and not why, deliberately: a cleared
 * cookie jar, a revoked session, a ban and an expiry are indistinguishable from
 * here. What separates them is `hours_signed_in` -- everything a person chooses
 * to do is spread across the range, and only a mechanical expiry piles up on one
 * value. A spike there is the alarm; the number it spikes at names the horizon
 * that is cutting people off.
 *
 * The identity is forgotten on the way out so this fires once per lost session
 * rather than on every page load that follows it.
 */
function reportLostSession(posthog: NonNullable<ReturnType<typeof usePostHog>>): void {
  const storage = authIntentStorage();
  const deliberate = readStoredValue(storage, ANALYTICS_DELIBERATE_SIGN_OUT_KEY) !== null;

  const lost = resolveLostSession({
    storedUserId: readStoredValue(storage, ANALYTICS_IDENTITY_KEY),
    storedSessionStartedAt: readStoredValue(storage, ANALYTICS_SESSION_STARTED_KEY),
    deliberate,
    now: Date.now(),
  });

  // Cleared whether or not anything was reported: it answers "since the last
  // load", and leaving it set would silence the next genuine loss.
  removeStoredValue(storage, ANALYTICS_DELIBERATE_SIGN_OUT_KEY);

  if (!lost || reportedThisPageLoad) return;
  reportedThisPageLoad = true;

  removeStoredValue(storage, ANALYTICS_IDENTITY_KEY);
  removeStoredValue(storage, ANALYTICS_SESSION_KEY);
  removeStoredValue(storage, ANALYTICS_SESSION_STARTED_KEY);

  posthog.capture('session_lost', { hours_signed_in: lost.hoursSignedIn });
}

/**
 * Lets go of a distinct id from the old display-name scheme so the account id can
 * take over.
 *
 * posthog-js refuses to re-identify someone who is already identified: it logs a
 * warning and keeps the existing distinct id. Without this, every reader signed in
 * at the time of the switch would quietly stay keyed on their display name for
 * ever, and the whole point of moving to the account id -- that `username` has no
 * unique constraint, so two people sharing a name share a PostHog person -- would
 * be lost on exactly the readers who already exist.
 *
 * Two independent signals, because either alone has a hole. Matching the username
 * is exact but needs one, and a session that arrived without a name would strand
 * that reader on the old key silently. `$user_state` covers that case but is a
 * detail of the SDK's storage, so it is not trusted on its own.
 *
 * Anonymous readers must never reach the reset: their history is precisely what
 * `identify` is about to merge into the account, and it is the pre-signup half of
 * every attribution question this instrumentation exists to answer. The early
 * return on an already-migrated id keeps this to genuinely once per browser.
 *
 * @returns whether a reset actually happened.
 */
function releaseLegacyIdentity(
  posthog: NonNullable<ReturnType<typeof usePostHog>>,
  userId: string,
  userName: string | null,
): boolean {
  const distinctId = posthog.get_distinct_id();
  if (!distinctId || distinctId === userId) return false;

  const looksIdentified = distinctId === userName || posthog.get_property('$user_state') === 'identified';
  if (!looksIdentified) return false;

  posthog.reset();
  return true;
}

/**
 * The person properties worth keeping current.
 *
 * `user_id` is here rather than only in the distinct id so a PostHog person can
 * be joined back to a row in our own database without parsing the distinct id.
 */
function currentPersonProperties(store: ReturnType<typeof userStore>) {
  return {
    user_id: store.userId ?? undefined,
    email_category: emailCategory(store.userEmail),
    role: store.userInfo?.role ?? undefined,
    content_rating: store.preferences?.contentRatingPreferences,
    media_name_language: store.preferences?.mediaNameLanguage,
    has_anki_configured: (store.preferences?.ankiProfiles?.length ?? 0) > 0,
    anki_profile_count: store.preferences?.ankiProfiles?.length ?? 0,
    hidden_media_count: store.preferences?.hiddenMedia?.length ?? 0,
    hidden_categories: store.preferences?.hiddenCategories ?? [],
    default_search_category: store.preferences?.defaultSearchCategory ?? 'ALL',
  };
}

/**
 * Keeps the acquisition distinction that an email address used to provide,
 * without sending an address or even a domain to PostHog. A custom domain is a
 * useful proxy for a school, team, or developer workflow; the exact domain is
 * not needed to answer that product question.
 */
function emailCategory(email: string | null | undefined): 'personal_provider' | 'custom_domain' | undefined {
  const domain = email?.trim().toLowerCase().split('@')[1];
  if (!domain) return undefined;

  return PERSONAL_EMAIL_DOMAINS.has(domain) ? 'personal_provider' : 'custom_domain';
}
