/**
 * The bookkeeping behind "what made this person create an account".
 *
 * Everything here is pure so it can be tested without a browser, a Nuxt app or a
 * PostHog client. The plugins and composables that use it supply the storage and
 * the clock.
 *
 * Two problems are solved:
 *
 * 1. **Attribution survives the redirect.** The interesting property of a signup
 *    is what the visitor was trying to do when they hit the wall -- add a card to
 *    Anki, save to a collection, report a segment. That intent is known at the
 *    moment the modal opens, and then the browser leaves for Google and comes
 *    back on a fresh page load with every bit of in-memory state gone. So it is
 *    parked in storage and read back on the other side.
 *
 * 2. **The transition is detected without depending on the callback.** The old
 *    code inferred "a login just happened" from OAuth query parameters that
 *    better-auth never actually sent back, so it inferred it approximately never.
 *    `resolveAuthTransition` instead compares the account we are looking at now
 *    against the last one this browser recorded, which needs no cooperation from
 *    the auth provider at all.
 */

/**
 * The specific thing a signed-out visitor tried to do. This is the whole point of
 * the exercise -- `login_initiated` already told us people click login, and never
 * once told us why.
 *
 * Add a member here rather than passing a free string, so the values stay a
 * closed set that a PostHog breakdown can be read off without cleaning.
 */
export const AUTH_GATES = [
  'anki_add_last',
  'anki_add_search',
  'collection_choose',
  'report_segment',
  // The two below are not walls the reader ran into -- they are asks we made
  // first, from `useSignupNudge`. They sit in the same closed set anyway so that
  // one PostHog breakdown compares "we blocked them" against "we offered", which
  // is the comparison that decides whether either approach is worth keeping.
  'download_nudge',
  'depth_nudge',
] as const;

export type AuthGate = (typeof AUTH_GATES)[number];

/** Where the login modal was opened from, when it was not a feature gate. */
export type AuthSource = AuthGate | 'header' | 'unknown';

export type AuthProvider = 'google' | 'discord' | 'magic_link';

export interface AuthIntent {
  /** The gate that sent them here, absent when they just used the header button. */
  gate?: AuthGate;
  source: AuthSource;
  /** Only known once they pick a provider, which is after the modal opens. */
  provider?: AuthProvider;
  /** Epoch ms, so a stale intent can be discarded rather than misattributed. */
  at: number;
}

export const AUTH_INTENT_KEY = 'nd-auth-intent';

/**
 * How long a parked intent stays believable.
 *
 * An OAuth round trip is seconds and a magic link is usually opened within a few
 * minutes. An hour is generous for both while still ruling out the case this
 * guards against: a visitor who abandons the modal, comes back tomorrow, signs in
 * from the header, and gets their signup credited to a gate they touched once and
 * forgot about.
 */
export const AUTH_INTENT_TTL_MS = 60 * 60 * 1000;

/**
 * How recently an account must have been created for its first sighting to count
 * as a signup rather than a login.
 *
 * Only consulted for an account this browser has never seen, so it is not doing
 * the heavy lifting -- it exists to stop an established user signing in on a new
 * device from being counted as a new account.
 */
export const NEW_ACCOUNT_WINDOW_MS = 5 * 60 * 1000;

/** The subset of the Storage API used here, so tests can pass a plain object. */
export interface IntentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Where a parked intent lives.
 *
 * `localStorage`, not `sessionStorage`, and the difference decides whether magic
 * link is measurable at all. An OAuth redirect navigates the same tab, so either
 * would survive it -- but a magic link is clicked in an email client, which opens
 * a *new* tab, and a new tab gets a fresh empty `sessionStorage`. Since magic link
 * is the provider most signups actually complete on, parking it per-tab would have
 * left the majority of signups reporting `source: 'unknown'`.
 *
 * The staleness that per-tab storage would have bought us is covered instead by
 * the TTL and by reading destructively, so nothing is really given up.
 *
 * Reading `window.localStorage` can itself throw when storage is blocked by
 * policy, so even the lookup is guarded.
 */
export function authIntentStorage(): IntentStorage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function rememberAuthIntent(storage: IntentStorage | undefined, intent: AuthIntent): void {
  if (!storage) return;
  try {
    storage.setItem(AUTH_INTENT_KEY, JSON.stringify(intent));
  } catch {
    // Storage can be full or blocked outright (Safari private mode throws on
    // write). Losing attribution on one signup is not worth breaking the login
    // the visitor is in the middle of.
  }
}

/**
 * Merges into whatever intent is already parked instead of replacing it.
 *
 * The gate is known when the modal opens and the provider only once a button is
 * pressed, so the two arrive as separate writes describing one journey.
 */
export function updateAuthIntent(storage: IntentStorage | undefined, patch: Partial<AuthIntent>, now: number): void {
  if (!storage) return;
  const existing = readAuthIntent(storage, now);
  rememberAuthIntent(storage, {
    source: 'unknown',
    ...existing,
    ...patch,
    at: now,
  });
}

/** Reads without clearing. Returns nothing for absent, malformed or expired state. */
export function readAuthIntent(storage: IntentStorage | undefined, now: number): AuthIntent | null {
  if (!storage) return null;

  let raw: string | null = null;
  try {
    raw = storage.getItem(AUTH_INTENT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const intent = parsed as AuthIntent;
  if (typeof intent.at !== 'number' || !Number.isFinite(intent.at)) return null;
  if (now - intent.at > AUTH_INTENT_TTL_MS) return null;

  return intent;
}

/** Reads and clears, so one parked intent is credited to exactly one signup. */
export function consumeAuthIntent(storage: IntentStorage | undefined, now: number): AuthIntent | null {
  const intent = readAuthIntent(storage, now);
  if (storage) {
    try {
      storage.removeItem(AUTH_INTENT_KEY);
    } catch {
      // Same reasoning as the write above.
    }
  }
  return intent;
}

/**
 * The query parameter marking a page load as the landing after an auth round
 * trip.
 *
 * It exists because better-auth hands the reader back to whatever `callbackURL`
 * was asked for and adds nothing of its own -- no `code`, no `state`. Detecting
 * the landing therefore has to be arranged on the way out, not read off the way
 * back in.
 */
export const AUTH_CALLBACK_PARAM = 'nd_auth';

/**
 * Adds the callback marker to a URL, replacing any marker already on it so a
 * second login from a callback page does not accumulate duplicates.
 */
export function withAuthCallbackMarker(url: string): string {
  try {
    const parsed = new URL(url, 'https://nadeshiko.co');
    parsed.searchParams.set(AUTH_CALLBACK_PARAM, '1');
    // Relative in, relative out: `callbackURL` is sent to better-auth, which
    // compares it against the configured trusted origins.
    return /^https?:/i.test(url) ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

export const AUTH_SOURCE_PARAM = 'nd_src';
export const AUTH_GATE_PARAM = 'nd_gate';

/**
 * Writes the intent into the callback URL itself.
 *
 * Storage covers a redirect and it covers a new tab, but it cannot cover a new
 * *device*: a magic link mailed to a phone and opened on a laptop arrives in a
 * browser that has never seen the intent. The link is the only thing that crosses
 * that gap, so for magic link -- the provider most signups actually complete on --
 * the intent travels in the link as well as in storage.
 *
 * Only meaningful for magic link. OAuth hands its `callbackURL` to the provider,
 * and the round trip stays in one browser anyway.
 */
export function withAuthIntentParams(url: string, intent: AuthIntent | null): string {
  if (!intent) return url;

  try {
    const parsed = new URL(url, 'https://nadeshiko.co');
    if (intent.source && intent.source !== 'unknown') parsed.searchParams.set(AUTH_SOURCE_PARAM, intent.source);
    if (intent.gate) parsed.searchParams.set(AUTH_GATE_PARAM, intent.gate);
    return /^https?:/i.test(url) ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

/**
 * Rebuilds a parked intent from the landing URL when this browser has none.
 *
 * Fills only what is missing, so a local intent -- which is richer, having seen
 * the provider button pressed -- is never overwritten by the thinner version that
 * travelled in the link.
 *
 * Values are validated against the closed sets rather than trusted. They arrive in
 * a URL anyone can edit, and an unchecked value here would show up as a made-up
 * category in a PostHog breakdown.
 */
export function absorbIntentFromUrl(storage: IntentStorage | undefined, search: string, now: number): void {
  if (!storage || !search) return;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return;
  }

  const patch: Partial<AuthIntent> = {};

  // The magic-link marker is itself the evidence of which provider was used --
  // the reader may be on a device that never saw the modal.
  if (params.get('magic_callback') === '1') patch.provider = 'magic_link';

  const source = params.get(AUTH_SOURCE_PARAM);
  if (source === 'header' || isAuthGate(source)) patch.source = source;

  const gate = params.get(AUTH_GATE_PARAM);
  if (isAuthGate(gate)) patch.gate = gate;

  if (Object.keys(patch).length === 0) return;

  // Spelled out rather than spread, because "fill only what is missing" is not
  // what either spread order gives you: a local intent can hold an explicit
  // `unknown`, which would win over a real value from the link.
  const existing = readAuthIntent(storage, now);
  const localSource = existing?.source && existing.source !== 'unknown' ? existing.source : undefined;

  rememberAuthIntent(storage, {
    source: localSource ?? patch.source ?? 'unknown',
    gate: existing?.gate ?? patch.gate,
    provider: existing?.provider ?? patch.provider,
    // A link-derived intent gets a fresh window; an existing one keeps its own, so
    // absorbing cannot quietly revive something the TTL had already retired.
    at: existing?.at ?? now,
  });
}

function isAuthGate(value: string | null): value is AuthGate {
  return value != null && (AUTH_GATES as readonly string[]).includes(value);
}

/**
 * Where the last reported-on account lives.
 *
 * `localStorage` rather than `sessionStorage`: it has to outlive the tab, or
 * every new tab would look like a fresh identity and report a login.
 */
export const ANALYTICS_IDENTITY_KEY = 'nd-analytics-user';

/**
 * Where the last reported-on *session* lives.
 *
 * This is the better-auth session's primary key, not its token -- the id is a row
 * identifier and carries no authority, so unlike the token it is safe to keep in
 * storage that JavaScript can read. better-auth refreshes a session by extending
 * the existing row, so this value changes on a genuine new sign-in and at no other
 * time, which is what makes `user_logged_in` exact rather than a floor.
 */
export const ANALYTICS_SESSION_KEY = 'nd-analytics-session';

/**
 * When the session this browser is signed in with began, as milliseconds.
 *
 * Kept alongside the identity because the question it answers can only be asked
 * once the session is already gone: "how long had they been signed in?" A reader
 * who signs out, clears cookies or is revoked produces a spread of ages; a
 * mechanical expiry produces the SAME age every time, and that spike is the only
 * thing that distinguishes a bug from ordinary churn. Sourced from the server's
 * `session.createdAt`, not from when this browser first noticed, so it is right
 * for sessions that predate this code.
 */
export const ANALYTICS_SESSION_STARTED_KEY = 'nd-analytics-session-started';

/**
 * Set when the reader signs out on purpose, and consumed by the next load.
 *
 * Without it every deliberate sign-out would be reported as a lost session:
 * `logout()` deliberately leaves the identity key in place (so signing straight
 * back in is not counted as a second signup), which is exactly the state a
 * silent expiry leaves behind. This is the one bit that tells them apart.
 */
export const ANALYTICS_DELIBERATE_SIGN_OUT_KEY = 'nd-analytics-signed-out';

export function readStoredValue(storage: IntentStorage | undefined, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function removeStoredValue(storage: IntentStorage | undefined, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Same tolerance as the writes: storage can be blocked outright. The cost is
    // a repeated event, never a broken page.
  }
}

export function writeStoredValue(storage: IntentStorage | undefined, key: string, value: string): void {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // See `rememberAuthIntent`. The cost is a repeated login event, not a break.
  }
}

/**
 * Whether a browser that is now signed out lost a session it did not ask to
 * lose, and how old that session was.
 *
 * Pure, and separated from the composable, because this is the part worth being
 * sure of: it decides whether an event fires at all, and a false positive here
 * (reporting every deliberate sign-out) would bury the signal it exists to
 * surface under ordinary traffic.
 *
 * The age is deliberately reported in hours rather than days. A cookie that
 * expires on a fixed schedule produces a value that repeats to within a few
 * hours across thousands of readers, and rounding to days would blur exactly the
 * detail that makes the spike visible.
 */
export function resolveLostSession(input: {
  /** The account this browser last reported on. Nothing means it was never signed in here. */
  storedUserId: string | null;
  /** When that session began, as the stored millisecond string. */
  storedSessionStartedAt: string | null;
  /** Whether the reader signed out on purpose since the last load. */
  deliberate: boolean;
  now: number;
}): { hoursSignedIn: number | null } | null {
  if (!input.storedUserId || input.deliberate) return null;

  const startedAt = Number(input.storedSessionStartedAt);
  const usable = Number.isFinite(startedAt) && startedAt > 0 && startedAt <= input.now;

  return { hoursSignedIn: usable ? Math.round(((input.now - startedAt) / 3_600_000) * 10) / 10 : null };
}

export type AuthTransition = 'signup_completed' | 'user_logged_in';

export interface AuthTransitionInput {
  /** The account now in session, or nothing when signed out. */
  currentUserId: string | null;
  /** The last account this browser reported on, from durable storage. */
  storedUserId: string | null;
  /** The session now in play. A new one means a genuine sign-in just happened. */
  currentSessionId: string | null;
  /** The last session this browser reported on. */
  storedSessionId: string | null;
  /** `createdAt` off the session user, used only to separate signup from login. */
  accountCreatedAt: string | null;
  now: number;
  /**
   * Whether this page load is the landing after an auth round trip.
   *
   * A fallback, not the primary signal: the session id above settles the question
   * on its own. This only matters if a session ever arrives without an id, in
   * which case a callback landing is still good evidence a login just happened.
   */
  viaCallback: boolean;
}

/**
 * Decides which auth event -- if any -- this page load represents.
 *
 * The stored id is deliberately *not* cleared on logout. If it were, signing out
 * and straight back in within the new-account window would look like a brand new
 * identity attached to a freshly created account, and report a second
 * `signup_completed` for an account that was only ever created once. Keeping it
 * means `signup_completed` can only fire on the first sighting of an id, which is
 * the property that makes the number trustworthy.
 */
export function resolveAuthTransition(input: AuthTransitionInput): AuthTransition | null {
  const { currentUserId, storedUserId, currentSessionId, storedSessionId, accountCreatedAt, now, viaCallback } = input;

  if (!currentUserId) return null;

  // An account this browser has never reported on. Only here can a signup be
  // declared, which is what keeps the number honest: an account is new exactly
  // once, no matter how many times it signs in afterwards.
  if (storedUserId !== currentUserId) {
    return isRecentlyCreated(accountCreatedAt, now) ? 'signup_completed' : 'user_logged_in';
  }

  // Same account as last time. A new session id means they really did sign in
  // again -- better-auth extends the existing row when it refreshes a session, so
  // the id only moves on a fresh sign-in.
  if (currentSessionId) return currentSessionId === storedSessionId ? null : 'user_logged_in';

  // No session id to compare. Fall back to the weaker signal.
  return viaCallback ? 'user_logged_in' : null;
}

function isRecentlyCreated(accountCreatedAt: string | null, now: number): boolean {
  if (!accountCreatedAt) return false;
  const createdAt = new Date(accountCreatedAt).getTime();
  if (!Number.isFinite(createdAt)) return false;
  const age = now - createdAt;
  // A negative age means the account is dated in the future -- clock skew between
  // the browser and the server. Treat it as just-created rather than as ancient.
  return age < NEW_ACCOUNT_WINDOW_MS;
}

/**
 * The properties every auth event carries, so `signup_completed`,
 * `user_logged_in` and `auth_gate_hit` can be broken down the same way and
 * compared against each other without reconciling three vocabularies.
 */
export function authEventProperties(intent: AuthIntent | null): {
  provider: AuthProvider | 'unknown';
  source: AuthSource;
  gate: AuthGate | null;
} {
  return {
    provider: intent?.provider ?? 'unknown',
    source: intent?.source ?? 'unknown',
    gate: intent?.gate ?? null,
  };
}

/**
 * The acquisition properties to stamp permanently on the person at signup, with
 * the unknowns left out.
 *
 * `$set_once` can only ever be written once, so recording `provider: 'unknown'`
 * because the parked intent went missing would burn the slot -- the person would
 * carry a confident "we don't know" that nothing could later correct. Omitting the
 * key leaves the person without the property, which reads honestly in PostHog and
 * stays open to a backfill.
 *
 * Returns an empty object, not an empty `$set_once`, so a signup we learned
 * nothing about does not send a pointless person update.
 */
export function acquisitionSetOnce(properties: ReturnType<typeof authEventProperties>): {
  $set_once?: Record<string, string>;
} {
  const setOnce: Record<string, string> = {};
  if (properties.provider !== 'unknown') setOnce.signup_provider = properties.provider;
  if (properties.source !== 'unknown') setOnce.signup_source = properties.source;
  if (properties.gate) setOnce.signup_gate = properties.gate;

  return Object.keys(setOnce).length > 0 ? { $set_once: setOnce } : {};
}

/**
 * Where this browser first arrived from, recorded once and never again.
 *
 * WHY THIS EXISTS RATHER THAN `$initial_referring_domain`. posthog-js sets that
 * family of properties, but only on a person profile, and `person_profiles`
 * defaults to `identified_only` -- so for a signed-out visitor there is no
 * profile to set them on, and by the time one exists (at signup) the referrer is
 * whichever OAuth provider just redirected them back. In the 90 days to
 * 2026-08-20 that left 18,538 of ~18,900 people with no first-touch property at
 * all, which is why "where do our signups come from" had no answer: the
 * event-level referrer was fine and there was nothing to join it to.
 *
 * Turning `person_profiles` up to `always` would also fix it, at the cost of a
 * billable profile for every anonymous reader. This costs one localStorage key.
 */
export const FIRST_TOUCH_KEY = 'nd-first-touch';

export interface FirstTouch {
  /** Referring domain, or `$direct`. Matches what posthog-js would have stored. */
  referrer: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  /** Where they landed, path only -- a full URL would carry the query with it. */
  landing: string;
  /** Epoch ms. Never compared against, only reported; the age is the useful part. */
  at: number;
}

/**
 * The referring domain, with our own domain folded into `$direct`.
 *
 * A same-origin referrer is an internal navigation that happened to be a full
 * page load, not an acquisition, and counting it as one is not a rounding error:
 * `nadeshiko.co` was the second-largest "source" on the site at 2,389 people.
 */
function referrerDomain(referrer: string, ownHost: string): string {
  if (!referrer) return '$direct';
  try {
    const { hostname } = new URL(referrer);
    return hostname === ownHost ? '$direct' : hostname;
  } catch {
    return '$direct';
  }
}

/**
 * Records the first touch, or leaves the existing one alone.
 *
 * WRITE-ONCE IS THE ENTIRE CONTRACT. The second visit, the OAuth round trip and
 * every later page load all call this, and any of them overwriting would turn
 * "where did they come from" into "where were they last", which is the question
 * the event-level referrer already answers.
 */
export function rememberFirstTouch(
  storage: IntentStorage | undefined,
  visit: { referrer: string; search: string; pathname: string; ownHost: string },
  now: number,
): void {
  if (!storage) return;

  try {
    if (storage.getItem(FIRST_TOUCH_KEY)) return;
  } catch {
    return;
  }

  const params = new URLSearchParams(visit.search);
  const touch: FirstTouch = {
    referrer: referrerDomain(visit.referrer, visit.ownHost),
    landing: visit.pathname,
    at: now,
  };

  // Omitted rather than stored empty, for the same reason `acquisitionSetOnce`
  // omits an unknown provider: these become `$set_once` keys, and a blank one
  // burns the slot on a confident nothing.
  const source = params.get('utm_source');
  const medium = params.get('utm_medium');
  const campaign = params.get('utm_campaign');
  if (source) touch.utmSource = source;
  if (medium) touch.utmMedium = medium;
  if (campaign) touch.utmCampaign = campaign;

  try {
    storage.setItem(FIRST_TOUCH_KEY, JSON.stringify(touch));
  } catch {
    // Same reasoning as `rememberAuthIntent`: attribution is never worth
    // breaking the visit it is describing.
  }
}

/** Reads the parked first touch. Absent or malformed both read as nothing. */
export function readFirstTouch(storage: IntentStorage | undefined): FirstTouch | null {
  if (!storage) return null;

  let raw: string | null = null;
  try {
    raw = storage.getItem(FIRST_TOUCH_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<FirstTouch>;
    if (typeof parsed?.referrer !== 'string') return null;
    return {
      referrer: parsed.referrer,
      landing: typeof parsed.landing === 'string' ? parsed.landing : '/',
      at: typeof parsed.at === 'number' ? parsed.at : 0,
      ...(parsed.utmSource ? { utmSource: parsed.utmSource } : {}),
      ...(parsed.utmMedium ? { utmMedium: parsed.utmMedium } : {}),
      ...(parsed.utmCampaign ? { utmCampaign: parsed.utmCampaign } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * The first touch as person properties, for the signup identify.
 *
 * `$set_once` rather than `$set`, matching `acquisitionSetOnce`: this describes
 * how the account was won and must not move when they come back through a
 * different door.
 */
export function firstTouchSetOnce(storage: IntentStorage | undefined): { $set_once?: Record<string, string> } {
  const touch = readFirstTouch(storage);
  if (!touch) return {};

  const setOnce: Record<string, string> = {
    first_touch_referrer: touch.referrer,
    first_touch_landing: touch.landing,
  };
  if (touch.utmSource) setOnce.first_touch_utm_source = touch.utmSource;
  if (touch.utmMedium) setOnce.first_touch_utm_medium = touch.utmMedium;
  if (touch.utmCampaign) setOnce.first_touch_utm_campaign = touch.utmCampaign;

  return { $set_once: setOnce };
}
