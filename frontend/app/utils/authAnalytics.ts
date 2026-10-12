/**
 * Persist signup intent across auth redirects and detect auth transitions from stored account/session
 * identity. Callers supply storage and time.
 */

/**
 * Closed attribution vocabulary for feature gates and prompts; keep analytics breakdowns free of arbitrary
 * strings.
 */
export const AUTH_GATES = [
  'anki_add_last',
  'anki_add_search',
  'collection_choose',
  'report_segment',
  // Proactive prompts share the gate vocabulary. Add-menu and download offers share a cooldown but remain
  // separate attribution sources.
  'download_nudge',
  'add_nudge',
  'depth_nudge',
  'roadmap_proposal',
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
 * Allow an hour for OAuth or email-link completion without crediting a later unrelated sign-in to an
 * abandoned gate.
 */
export const AUTH_INTENT_TTL_MS = 60 * 60 * 1000;

/**
 * Only a recently created account unseen by this browser counts as signup; established accounts on a new
 * device count as login.
 */
export const NEW_ACCOUNT_WINDOW_MS = 5 * 60 * 1000;

/** The subset of the Storage API used here, so tests can pass a plain object. */
export interface IntentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Use localStorage because email links can open a new tab. TTL and destructive consumption bound stale
 * attribution. Even accessing storage can throw when policy blocks it.
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
 * Mark the callback URL ourselves: better-auth returns to the supplied URL without adding a success marker.
 */
export const AUTH_CALLBACK_PARAM = 'nd_auth';

/** The fixed browser-facing landing path used for social OAuth. */
export const AUTH_CALLBACK_PATH = '/auth/callback';

/** The short-lived same-origin destination parked across the provider redirect. */
export const AUTH_RETURN_TO_KEY = 'nd-auth-return-to';
export const AUTH_RETURN_TO_TTL_MS = 15 * 60 * 1000;

export function authReturnToStorage(): IntentStorage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** Store only a same-origin path, never an external redirect target. */
export function rememberAuthReturnTo(storage: IntentStorage | undefined, url: string, origin: string): void {
  if (!storage) return;
  try {
    const parsed = new URL(url, origin);
    if (parsed.origin !== origin) return;
    storage.setItem(
      AUTH_RETURN_TO_KEY,
      JSON.stringify({ path: `${parsed.pathname}${parsed.search}${parsed.hash}`, createdAt: Date.now() }),
    );
  } catch {
    // A blocked or malformed storage value must not break sign-in.
  }
}

export function consumeAuthReturnTo(storage: IntentStorage | undefined, now = Date.now()): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(AUTH_RETURN_TO_KEY);
    storage.removeItem(AUTH_RETURN_TO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { path?: unknown; createdAt?: unknown };
    return typeof parsed.path === 'string' &&
      parsed.path.startsWith('/') &&
      !parsed.path.startsWith('//') &&
      typeof parsed.createdAt === 'number' &&
      Number.isFinite(parsed.createdAt) &&
      now - parsed.createdAt >= 0 &&
      now - parsed.createdAt <= AUTH_RETURN_TO_TTL_MS
      ? parsed.path
      : null;
  } catch {
    return null;
  }
}

export function isAuthCallbackPath(path: string): boolean {
  return /^\/(?:en|es|ja|zh|zh-hant|id|pt-BR)?\/?auth\/callback\/?$/.test(path);
}

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
 * Carry magic-link intent in the callback URL as well as storage so attribution survives opening the link on
 * another device. OAuth stays in one browser.
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
 * Fill missing intent from the landing URL without replacing richer local values. Validate source and gate
 * against closed sets because URL parameters are user-editable.
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

  // Treat explicit `unknown` as missing while retaining known local values; a simple spread cannot express
  // both rules.
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
 * Store the session row id, never its authority-bearing token. Refresh extends the same row; a new id signals
 * a new sign-in.
 */
export const ANALYTICS_SESSION_KEY = 'nd-analytics-session';

/**
 * Persist server `session.createdAt` to measure session age after disappearance. Repeated expiry ages help
 * distinguish mechanical expiry from ordinary churn.
 */
export const ANALYTICS_SESSION_STARTED_KEY = 'nd-analytics-session-started';

/**
 * Mark deliberate logout separately: the retained identity key otherwise makes it indistinguishable from
 * silent expiry.
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
 * Report session loss only when a prior identity exists and logout was not deliberate. Express age in hours
 * to preserve fixed-expiry spikes.
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
   * Fallback sign-in evidence when no session id is available; session-id comparison is the primary signal.
   */
  viaCallback: boolean;
}

/**
 * Retain the stored identity on logout so signing straight back into a newly created account cannot report a
 * second signup.
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
 * Omit unknown acquisition values from `$set_once` so they remain backfillable. Return no person update when
 * nothing is known.
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
 * Persist anonymous first touch until signup: with `identified_only` profiles, PostHog's initial-referrer
 * properties may be absent until the OAuth return. Avoid creating a billable profile for every anonymous
 * visit.
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

/** Treat same-host referrers as direct; internal full-page navigation is not acquisition. */
function referrerDomain(referrer: string, ownHost: string): string {
  if (!referrer) return '$direct';
  try {
    const { hostname } = new URL(referrer);
    return hostname === ownHost ? '$direct' : hostname;
  } catch {
    return '$direct';
  }
}

/** Write once: later visits and OAuth returns must not replace the original acquisition source. */
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

/** Use `$set_once` for acquisition properties so later visits cannot replace the account's first touch. */
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
