/**
 * Moves `User.last_seen_at` (and, when we know it, `last_seen_country`).
 *
 * Called from the session hooks rather than from a request middleware, because
 * a session is created or refreshed far less often than it is used: better-auth
 * refreshes past `updateAge`, so this runs about once a week per active reader
 * instead of once per request. See the migration for what that costs in
 * precision and why it is the right trade.
 *
 * NOTHING HERE MAY FAIL A SIGN-IN. It runs from an after-hook, so the session
 * is already written and committed by the time this is reached; an exception
 * escaping would turn a bookkeeping problem into a reader who cannot log in.
 * Every failure is logged and swallowed.
 */

import { User } from '@app/models/User';
import { logger } from '@config/log';

/**
 * `country` is optional, and absent is not the same as none: a request that
 * arrived without `CF-IPCountry` leaves the stored country alone rather than
 * clearing it. Nulling would throw away a known country in exchange for
 * nothing -- the reader has not moved anywhere we can name, we simply could not
 * look this time.
 */
export async function recordLastSeen(userId: number, country: string | null): Promise<void> {
  if (!Number.isInteger(userId) || userId <= 0) return;

  try {
    await User.update(
      { id: userId },
      {
        lastSeenAt: new Date(),
        ...(country ? { lastSeenCountry: country } : {}),
      },
    );
  } catch (error) {
    // Deliberately swallowed. The session is already committed; this column is
    // a convenience and must never be the reason a sign-in reports failure.
    logger.warn({ err: error, userId }, 'Could not record last seen');
  }
}

/**
 * The session shape the after-hooks receive, narrowed to what this needs.
 *
 * `impersonatedBy` is the field that has to be respected: an admin acting as
 * another account is not that account being used, and treating it as such would
 * corrupt the only signal these columns carry.
 */
export interface SessionLike {
  userId?: unknown;
  impersonatedBy?: unknown;
}

/**
 * Whether a written session should move the reader's last-seen.
 *
 * Exported for the tests, and because the rule is easier to trust when it is
 * one named predicate rather than a condition repeated in two hooks.
 */
export function shouldRecordLastSeen(session: SessionLike | null | undefined): boolean {
  if (!session) return false;
  if (session.impersonatedBy) return false;

  return resolveUserId(session) !== null;
}

/** better-auth hands ids back as numbers or numeric strings depending on path. */
export function resolveUserId(session: SessionLike | null | undefined): number | null {
  const raw = session?.userId;
  const id = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;

  return Number.isInteger(id) && id > 0 ? id : null;
}
