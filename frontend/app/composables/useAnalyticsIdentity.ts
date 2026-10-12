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
  firstTouchSetOnce,
  readFirstTouch,
  readStoredValue,
  rememberFirstTouch,
  removeStoredValue,
  resolveAuthTransition,
  resolveLostSession,
  writeStoredValue,
} from '~/utils/authAnalytics';
import { onPostHogReady } from '~/utils/posthogClient';

/**
 * Page-load guard shared by identity-auth and auth-callback: the first reported transition
 * wins.
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
 * Reconcile on every client load using account/session state, not provider-specific OAuth
 * callback parameters.
 */
export function reconcileAnalyticsIdentity(options: { viaCallback: boolean }) {
  if (!import.meta.client) return;

  const store = userStore();

  /**
   * Snapshot arrival before waiting for PostHog: auth-callback strips the query at app:mounted,
   * potentially before the SDK loads, which would lose magic-link attribution.
   */
  const arrival = {
    referrer: document.referrer,
    search: window.location.search,
    pathname: window.location.pathname,
    ownHost: window.location.hostname,
  };

  // Wait for the real SDK: migration decisions need get_distinct_id() and get_property(), which
  // the preload stub cannot answer. No client starts outside production.
  onPostHogReady((posthog) => reconcile(posthog, store, arrival, options));
}

/** @param arrival Snapshotted in `reconcileAnalyticsIdentity`; see the note there. */
function reconcile(
  posthog: NonNullable<ReturnType<typeof usePostHog>>,
  store: ReturnType<typeof userStore>,
  arrival: { referrer: string; search: string; pathname: string; ownHost: string },
  options: { viaCallback: boolean },
) {
  // BEFORE THE SIGNED-OUT RETURN BELOW, and that is the whole point: the first
  // touch worth recording belongs to a visitor who does not have an account yet.
  // By the time one exists, `document.referrer` is whichever OAuth provider just
  // redirected them back. Write-once, so every later load is a no-op.
  rememberFirstTouch(authIntentStorage(), arrival, Date.now());

  // Signed-out state may be a lost session, not a first-time visit.
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
  absorbIntentFromUrl(storage, arrival.search, now);

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
    // Write acquisition properties once on signup, not later login, so person-level retention
    // breakdowns retain the original gate.
    ...(transition === 'signup_completed'
      ? {
          ...signupOriginProperties(readFirstTouch(storage), arrival.pathname),
          ...mergeSetOnce(acquisitionSetOnce(properties), firstTouchSetOnce(storage)),
        }
      : {}),
  });
}

/**
 * Attribute signup to its first-touch page, not the OAuth return page; retain the callback path
 * separately for debugging.
 */
function signupOriginProperties(
  firstTouch: ReturnType<typeof readFirstTouch>,
  callbackPath: string,
): Record<string, string> {
  if (!firstTouch) return { auth_callback_path: callbackPath };

  return {
    $pathname: firstTouch.landing,
    signup_origin_path: firstTouch.landing,
    signup_origin_referrer: firstTouch.referrer,
    auth_callback_path: callbackPath,
    ...(firstTouch.utmSource ? { signup_origin_utm_source: firstTouch.utmSource } : {}),
    ...(firstTouch.utmMedium ? { signup_origin_utm_medium: firstTouch.utmMedium } : {}),
    ...(firstTouch.utmCampaign ? { signup_origin_utm_campaign: firstTouch.utmCampaign } : {}),
  };
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
 * Report the observed loss, not an inferred cause. Session age can reveal clustered expiry;
 * forget identity afterward so each lost session is reported once.
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
 * Release legacy display-name ids because PostHog refuses re-identification. Recognize them by
 * username or $user_state, but never reset anonymous history or an already-migrated id. Returns
 * whether a reset occurred.
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
    // Use $set semantics for $name so account renames update the same person's searchable
    // display label.
    $name: store.userName ?? undefined,
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

/**
 * Merge $set_once contents before capture; spreading the blocks directly would overwrite
 * earlier attribution.
 */
function mergeSetOnce(...blocks: Array<{ $set_once?: Record<string, string> }>): {
  $set_once?: Record<string, string>;
} {
  const merged = Object.assign({}, ...blocks.map((block) => block.$set_once ?? {})) as Record<string, string>;
  return Object.keys(merged).length > 0 ? { $set_once: merged } : {};
}
