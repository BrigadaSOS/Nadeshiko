import { type IntentStorage, readStoredValue, writeStoredValue } from '~/utils/authAnalytics';

/**
 * Rate-limit signed-out signup prompts by per-panel cooldown, lifetime ask budget and cross-panel quiet
 * period. Callers supply storage and time.
 */

/**
 * Closed panel vocabulary used for storage keys and analytics. Download offers export features; depth offers
 * follow sustained use.
 */
export const SIGNUP_NUDGES = ['download', 'depth'] as const;

export type SignupNudge = (typeof SIGNUP_NUDGES)[number];

/**
 * Download and add-menu triggers share one panel and cooldown to avoid duplicate asks, but retain separate
 * conversion attribution.
 */
export const NUDGE_TRIGGERS = ['download', 'add_menu', 'depth'] as const;

export type NudgeTrigger = (typeof NUDGE_TRIGGERS)[number];

/** Which panel a trigger raises, and so which cooldown it spends. */
export const NUDGE_BY_TRIGGER: Record<NudgeTrigger, SignupNudge> = {
  download: 'download',
  add_menu: 'download',
  depth: 'depth',
};

/**
 * A week before a repeat ask avoids prompting daily visitors on every visit; deliberately conservative rather
 * than data-tuned.
 */
export const NUDGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** Wait a month before the third ask so repeated prompts do not become a weekly habit. */
export const NUDGE_LATE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Cap each panel at three asks per browser. Clearing storage, private windows and other devices reset the
 * history.
 */
export const NUDGE_ASK_LIMIT = 3;

/** Any panel silences all panels for 48 hours so independent cooldowns cannot stack unanswered prompts. */
export const NUDGE_QUIET_MS = 48 * 60 * 60 * 1000;

/** Where the last sighting of any panel lives, for the cross-nudge quiet period. */
export const NUDGE_QUIET_KEY = 'nd-nudge-any';

/**
 * Either five plays or three searches earns the depth prompt. In 4,809 signed-out sessions, those thresholds
 * reached roughly 50% and 41% respectively; requiring both would exclude either usage pattern. Cooldowns
 * still cap repeat asks.
 */
export const DEPTH_PLAYS_THRESHOLD = 5;
export const DEPTH_SEARCHES_THRESHOLD = 3;

/** Where a nudge's history lives. One key per nudge, so the ladders are independent. */
export function nudgeStorageKey(nudge: SignupNudge): string {
  return `nd-nudge-${nudge}`;
}

/** What we remember about one panel: when it last appeared, and how it has been received. */
export interface NudgeRecord {
  /** When it was last shown. */
  at: number;
  /** How many times it has been shown, ever. */
  shows: number;
  /** How many times the reader answered it with "Not now". */
  dismissals: number;
}

/**
 * A dismissal spends an extra ask because an explicit refusal is stronger than leaving a persistent panel
 * unanswered.
 */
export function asksSpent(record: NudgeRecord): number {
  return record.shows + record.dismissals;
}

/** The wait owed after `spent` asks: a week before the second, a month before the last. */
export function nudgeCooldownMs(spent: number): number {
  return spent <= 1 ? NUDGE_COOLDOWN_MS : NUDGE_LATE_COOLDOWN_MS;
}

/**
 * Read legacy timestamps as one previous show. Absent or unreadable state is due rather than permanently
 * silenced.
 */
export function readNudgeRecord(storage: IntentStorage | undefined, nudge: SignupNudge): NudgeRecord | null {
  const raw = readStoredValue(storage, nudgeStorageKey(nudge));
  if (!raw) return null;

  const legacyTimestamp = Number(raw);
  if (Number.isFinite(legacyTimestamp)) return { at: legacyTimestamp, shows: 1, dismissals: 0 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const record = parsed as Partial<NudgeRecord>;
  if (typeof record.at !== 'number' || !Number.isFinite(record.at)) return null;

  return {
    at: record.at,
    shows: counterOr(record.shows, 1),
    dismissals: counterOr(record.dismissals, 0),
  };
}

/** A stored counter, or the fallback when it is missing or nonsense. */
function counterOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

/**
 * Check cross-panel quiet time, ask budget, then panel cooldown. Missing, malformed or future-dated
 * timestamps must not silence a prompt forever.
 */
export function isNudgeDue(storage: IntentStorage | undefined, nudge: SignupNudge, now: number): boolean {
  if (!isQuietPeriodOver(storage, now)) return false;

  const record = readNudgeRecord(storage, nudge);
  if (!record) return true;

  const spent = asksSpent(record);
  if (spent >= NUDGE_ASK_LIMIT) return false;

  if (record.at > now) return true;

  return now - record.at >= nudgeCooldownMs(spent);
}

/** Whether enough time has passed since *any* panel was raised. */
function isQuietPeriodOver(storage: IntentStorage | undefined, now: number): boolean {
  const raw = readStoredValue(storage, NUDGE_QUIET_KEY);
  if (!raw) return true;

  const lastAskedAt = Number(raw);
  if (!Number.isFinite(lastAskedAt) || lastAskedAt > now) return true;

  return now - lastAskedAt >= NUDGE_QUIET_MS;
}

/**
 * Spend an ask when the panel appears, not when answered; the interruption is the cost. Return its 1-based
 * show count for analytics.
 */
export function recordNudgeShown(storage: IntentStorage | undefined, nudge: SignupNudge, now: number): number {
  const previous = readNudgeRecord(storage, nudge);
  const record: NudgeRecord = {
    at: now,
    shows: (previous?.shows ?? 0) + 1,
    dismissals: previous?.dismissals ?? 0,
  };

  writeStoredValue(storage, nudgeStorageKey(nudge), JSON.stringify(record));
  writeStoredValue(storage, NUDGE_QUIET_KEY, String(now));

  return record.shows;
}

/**
 * Spend an extra ask on dismissal without resetting its timestamp. If storage no longer contains the show, do
 * not invent a record.
 */
export function recordNudgeDismissed(storage: IntentStorage | undefined, nudge: SignupNudge): void {
  const previous = readNudgeRecord(storage, nudge);
  if (!previous) return;

  writeStoredValue(
    storage,
    nudgeStorageKey(nudge),
    JSON.stringify({ ...previous, dismissals: previous.dismissals + 1 }),
  );
}

export interface DepthCounts {
  /** Deliberate plays only -- see `useSignupNudge` for why autoplay is excluded. */
  plays: number;
  searches: number;
}

/** Whether this visit has earned the depth nudge. */
export function depthReached(counts: DepthCounts): boolean {
  return counts.plays >= DEPTH_PLAYS_THRESHOLD || counts.searches >= DEPTH_SEARCHES_THRESHOLD;
}
