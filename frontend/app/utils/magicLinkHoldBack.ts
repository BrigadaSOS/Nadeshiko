/**
 * How long the resend button stays out of reach, per mail already sent to this
 * browser.
 *
 * IT GROWS BECAUSE THE BUDGET IS SMALL. Asking for a sign-in link is capped at
 * five an hour, so a flat wait of a minute apiece spends all five inside four
 * minutes and leaves the reader staring at "too many sign-in attempts" for the
 * remaining fifty-six. Stretching the gaps spreads those five across roughly six
 * minutes instead, which is long enough for a slow provider to deliver.
 *
 * It stops at two minutes rather than climbing further: past that the wait is
 * punishing somebody who mistyped their address, and a mail that has not arrived
 * by then usually will not, whatever the delay before the next ask. The last
 * entry repeats for every send after it.
 *
 * Ported from shirabe's `EmailSignIn::HOLD_BACKS`, reasoning included.
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
