import { type IntentStorage, readStoredValue, writeStoredValue } from '~/utils/authAnalytics';

/**
 * The bookkeeping behind asking a signed-out reader to make an account, without
 * becoming the site that nags.
 *
 * Everything here is pure so it can be tested without a browser, a clock or a
 * toast library -- the composable supplies the storage and the time. The part
 * worth being sure of is `isNudgeDue`: it is the only thing standing between a
 * gentle ask and a prompt on every single download, and a bug in it is the kind
 * a reader punishes by leaving rather than by reporting.
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
 * How long a nudge stays quiet after it has been shown once.
 *
 * A week, and the number is the whole design. "Once per visit" was the obvious
 * first answer and it is wrong for exactly the readers we most want: someone who
 * opens the site daily would meet the same toast every day, which is not a
 * prompt any more, it is furniture. A week means a daily reader sees each ask
 * roughly four times a year and a one-off visitor sees it once.
 *
 * Deliberately generous rather than tuned -- there is no data to tune against
 * yet, and the failure that matters here is asymmetric: showing it too often
 * costs goodwill that does not come back, showing it too rarely costs a signup
 * that the next visit can still collect.
 */
export const NUDGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

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
 * These are per-session figures, so they overstate how often the panel appears:
 * the seven-day cooldown means a returning reader crosses the line most visits
 * and is asked on roughly one of them.
 */
export const DEPTH_PLAYS_THRESHOLD = 5;
export const DEPTH_SEARCHES_THRESHOLD = 3;

/** Where a nudge's last sighting lives. One key per nudge, so cooldowns are independent. */
export function nudgeStorageKey(nudge: SignupNudge): string {
  return `nd-nudge-${nudge}`;
}

/**
 * Whether this nudge may be shown now.
 *
 * Absent state means never shown, which is due. Unparseable or future-dated
 * state is treated as due as well: the alternative is a corrupted key silencing
 * an ask forever, and a reader who sees one extra toast because their clock is
 * wrong is a much cheaper mistake than a reader we never ask again.
 */
export function isNudgeDue(storage: IntentStorage | undefined, nudge: SignupNudge, now: number): boolean {
  const raw = readStoredValue(storage, nudgeStorageKey(nudge));
  if (!raw) return true;

  const lastShownAt = Number(raw);
  if (!Number.isFinite(lastShownAt) || lastShownAt > now) return true;

  return now - lastShownAt >= NUDGE_COOLDOWN_MS;
}

/**
 * Starts the cooldown.
 *
 * Called when the toast is *shown*, not when it is acted on, because the cost we
 * are rationing is the interruption. A reader who ignores it has still been
 * asked, and asking again tomorrow is the behaviour this whole module exists to
 * prevent.
 */
export function recordNudgeShown(storage: IntentStorage | undefined, nudge: SignupNudge, now: number): void {
  writeStoredValue(storage, nudgeStorageKey(nudge), String(now));
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
