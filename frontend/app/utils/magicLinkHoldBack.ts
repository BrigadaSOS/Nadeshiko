/**
 * Increase resend waits to conserve the five-per-hour sign-in budget while allowing delayed delivery. Cap at
 * two minutes to avoid excessive waits after a mistyped address; later sends repeat the final delay. Mirrors
 * Shirabe's hold-backs.
 */
export const MAGIC_LINK_HOLD_BACKS = [30, 60, 120] as const;

/**
 * The wait after `sendCount` mails, where the first send is 1.
 *
 * Clamped at both ends: a count of zero cannot index backwards, and anything
 * past the list repeats its last entry rather than running off it.
 */
export function holdBackFor(sendCount: number): number {
  const index = Math.min(Math.max(sendCount, 1) - 1, MAGIC_LINK_HOLD_BACKS.length - 1);
  return MAGIC_LINK_HOLD_BACKS[index] ?? MAGIC_LINK_HOLD_BACKS[0];
}
