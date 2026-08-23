import { type IntentStorage, readStoredValue, writeStoredValue } from '~/utils/authAnalytics';

/**
 * The bookkeeping behind asking a signed-out reader to make an account, without
 * becoming the site that nags.
 *
 * Everything here is pure so it can be tested without a browser, a clock or a
 * toast library -- the composable supplies the storage and the time. The part
 * worth being sure of is `isNudgeDue`: it is the only thing standing between a
 * gentle ask and a prompt on every single download, and a bug in it is the kind
 * a reader punishes by leaving rather than by reporting. It rations three
 * different things -- how soon one panel may repeat, how many times it ever
 * may, and how close together two different panels may land.
 *
 * Why this exists at all: the four gates in `AUTH_GATES` all live *inside* a
 * segment's dropdown menu, as disabled items. A reader has to open a menu to
 * discover something they are not allowed to do, so in practice almost nobody
 * meets them -- the header button accounts for nearly every login modal opened.
 * These two nudges are the first asks that come to the reader instead.
 */

/**
 * The moments we ask.
 *
 * A closed set for the same reason `AUTH_GATES` is one: each member becomes a
 * storage key and a PostHog breakdown value, and a free string would give us
 * both a typo'd key that silently never cools down and a made-up category in
 * the funnel.
 *
 * - `download` -- they reached for Anki, by saving a clip or by opening the add
 *   menu. Export is the thing an account adds to either, and it is the feature
 *   the signed-in population actually lives in. See `NUDGE_TRIGGERS` for why
 *   both moments spend one cooldown rather than two.
 * - `depth` -- they have used the site properly this visit and have not been
 *   asked anything yet.
 */
export const SIGNUP_NUDGES = ['download', 'depth'] as const;

export type SignupNudge = (typeof SIGNUP_NUDGES)[number];

/**
 * What made a nudge fire, which is not the same question as which nudge fired.
 *
 * `download` and `add_menu` both raise the `download` nudge -- the same panel,
 * the same offer, the same cooldown key -- because they are one ask arriving at
 * two moments: the reader who has just saved a clip, and the reader who has
 * opened the add menu and found the Anki entries greyed out. Sharing the
 * cooldown is the point rather than an accident: a reader who does both in one
 * sitting has been asked once, and asking again ten seconds later with identical
 * copy is exactly the nagging `NUDGE_COOLDOWN_MS` exists to prevent.
 *
 * They stay distinguishable in PostHog and in the parked auth intent, so the
 * question of which moment actually converts can be read off rather than guessed
 * at.
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
 * How long a nudge waits before it may be shown again.
 *
 * A week, and the number is the whole design for the *second* ask. "Once per
 * visit" was the obvious first answer and it is wrong for exactly the readers we
 * most want: someone who opens the site daily would meet the same toast every
 * day, which is not a prompt any more, it is furniture.
 *
 * Deliberately generous rather than tuned -- there is no data to tune against
 * yet, and the failure that matters here is asymmetric: showing it too often
 * costs goodwill that does not come back, showing it too rarely costs a signup
 * that the next visit can still collect.
 */
export const NUDGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The wait before the third and final ask.
 *
 * A week is the right gap for asking a second time; asking a third time a week
 * after that is where a prompt turns into a habit of the site rather than a
 * question. A month puts the last ask far enough out that the reader meeting it
 * is a different reader -- more invested, or back after a gap -- rather than the
 * same one being worn down.
 */
export const NUDGE_LATE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How many times we will ever raise one panel at the same reader.
 *
 * Without a cap the seven-day cooldown is only a slower version of the failure
 * it was written to prevent: a reader who comes back daily for a year would meet
 * each panel some fifty times. Three is where an ask stops being a reminder that
 * the feature exists -- someone who has read the same panel three times over
 * five weeks and not pressed it has told us what they think of it.
 *
 * `localStorage` makes this a cap per browser, not per person: cleared storage,
 * a second device or a private window all start the ladder again. That is a
 * reason to keep the cap rather than to reach for "never again" -- neither can
 * promise permanence, and only this one leaves the door open for the reader who
 * was asked at the wrong moment.
 */
export const NUDGE_ASK_LIMIT = 3;

/**
 * How long *any* panel silences *every* panel.
 *
 * The per-nudge cooldowns are independent, which is right for the ask itself and
 * wrong for the reader: someone who plays five clips and then opens the add menu
 * has met two different panels within a minute, and because the panel never
 * auto-dismisses (see `raiseNudgePanel`) the second one stacks on top of the
 * first. Two unanswered questions in one corner is not two asks, it is a site
 * that will not stop talking.
 *
 * Two days rather than a session, because "session" is not a thing this storage
 * can see, and because the same reasoning applies to tomorrow: they were asked
 * yesterday.
 */
export const NUDGE_QUIET_MS = 48 * 60 * 60 * 1000;

/** Where the last sighting of any panel lives, for the cross-nudge quiet period. */
export const NUDGE_QUIET_KEY = 'nd-nudge-any';

/**
 * What counts as having used the site properly, for the depth nudge.
 *
 * Either threshold on its own is enough -- they measure two different kinds of
 * reader and neither is the more serious one. Someone who plays clip after clip
 * from a single search is studying; someone who runs three searches is looking
 * for something specific. Requiring both would ask only the intersection, which
 * is the smallest group rather than the most convinced one.
 *
 * Five and three are drawn from what signed-out sessions actually do. Over a
 * month, of 4,809 such sessions: 60% play three or more clips, 50% reach five,
 * 37% reach ten, and 24% reach twenty. Ten was the first guess and it is later
 * than it sounds -- it waits out half the sessions that ever get going. Five is
 * still comfortably past sampling (three clips can be thirty seconds of idle
 * curiosity) while catching half of everyone. Searches sit at three because two
 * is where 54% land and three where 41% do; two would fire on a reader still
 * finding their footing.
 *
 * These are per-session figures, so they badly overstate how often the panel
 * appears: a returning reader crosses the line most visits, and the cooldown
 * ladder means they are asked on three of them, ever.
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
 * How much of the reader's patience one panel has already spent.
 *
 * A dismissal counts twice. The panel has no timeout, so leaving it unanswered
 * means the reader closed the tab or carried on around it -- which is a "no"
 * with a lot of other explanations available, including never having seen a
 * toast in the far corner. Pressing "Not now" has only one explanation. Counting
 * it double is what stops the ladder two asks early for the reader who has
 * actually answered, without treating silence as consent to keep going forever.
 */
export function asksSpent(record: NudgeRecord): number {
  return record.shows + record.dismissals;
}

/** The wait owed after `spent` asks: a week before the second, a month before the last. */
export function nudgeCooldownMs(spent: number): number {
  return spent <= 1 ? NUDGE_COOLDOWN_MS : NUDGE_LATE_COOLDOWN_MS;
}

/**
 * Reads a nudge's history, in either shape it has ever been written in.
 *
 * The original was a bare timestamp, written before there was a ladder to climb.
 * A browser carrying one has been shown the panel exactly once, which is what it
 * is read as -- migrating readers onto the ladder at rung one rather than
 * silencing them or starting them over.
 *
 * Returns nothing for absent or unreadable state, which callers treat as due for
 * the same reason they always have: a corrupted key must not be able to silence
 * an ask forever.
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
 * Whether this nudge may be shown now.
 *
 * Three gates, in the order they cost the reader: another panel just asked
 * something (`NUDGE_QUIET_MS`), this panel has used up its asks
 * (`NUDGE_ASK_LIMIT`), or its own cooldown has not elapsed.
 *
 * Absent state means never shown, which is due. Unparseable or future-dated
 * state is treated as due as well: the alternative is a corrupted key silencing
 * an ask forever, and a reader who sees one extra toast because their clock is
 * wrong is a much cheaper mistake than a reader we never ask again.
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
 * Starts the cooldown and moves this panel one rung up the ladder.
 *
 * Called when the toast is *shown*, not when it is acted on, because the cost we
 * are rationing is the interruption. A reader who never answers has still been
 * asked, and asking again tomorrow is the behaviour this whole module exists to
 * prevent.
 *
 * Returns which ask this was, 1-based, so the caller can report it. Whether a
 * second ask converts at all is the question the ladder is a guess at, and
 * without this number on the event there is no way to read the answer off.
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
 * Records that the reader said no, which spends an extra ask.
 *
 * Deliberately does not touch `at`: a dismissal is not a fresh interruption, it
 * is the answer to the one already counted. It only shortens what is left.
 *
 * Does nothing when there is no record to escalate -- storage cleared between
 * the panel appearing and the button being pressed leaves nothing to be sure
 * about, and inventing a record here would silence a panel we cannot show was
 * ever shown.
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
