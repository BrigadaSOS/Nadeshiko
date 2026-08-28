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

/**
 * Remembers which UTC day each account was last seen calling the API on.
 *
 * Bounded by the number of accounts that actually use the API, because an
 * account's entry is REPLACED when the day rolls over rather than added to --
 * the same shape, and for the same reason, as `apiActiveDayByUser` in
 * `services/analytics/posthog`.
 */
const apiLastSeenDayByUser = new Map<number, string>();

/**
 * The same signal as `recordLastSeen`, for a request that carried an API key
 * instead of a session.
 *
 * AN API KEY NEVER TOUCHES A SESSION, so neither hook above ever fires for one.
 * A key spending five thousand requests a month leaves `last_seen_at` exactly
 * where its owner's last browser sign-in left it, and dormancy reads that as an
 * account nobody has used -- so the reader who uses us hardest, through the
 * surface that has no cookie, is the one likeliest to get a win-back email.
 * This is the only writer that closes that gap.
 *
 * THROTTLED TO ONE WRITE A DAY PER ACCOUNT, and it has to be. The session hooks
 * are cheap because better-auth only refreshes past `updateAge` -- about weekly
 * per reader. This one sits on the authenticated request path, where the
 * natural rate is every request, and a write to `User` per API call is the
 * exact cost the migration weighed and rejected. A day of slack against a
 * thirty-day threshold is not error.
 *
 * TWO GATES, because neither alone is enough. The map skips the round trip in
 * the common case but is process-local, and production forks three workers, so
 * by itself it would allow three writes a day per account plus one per deploy.
 * The `WHERE` is what actually bounds them: Postgres evaluates it against the
 * row rather than against any one process's memory, so a busy account costs one
 * UPDATE that matches nothing, not one that writes.
 *
 * NO COUNTRY, deliberately. `last_seen_country` means "the last place we could
 * identify", and it is written from the Cloudflare header on a session hop. An
 * API key is as likely to be a server in a datacentre as a person, and writing
 * that would make the column mean two different things depending on which path
 * touched it last.
 */
export async function recordApiLastSeen(userId: number): Promise<void> {
  if (!Number.isInteger(userId) || userId <= 0) return;

  const today = new Date().toISOString().slice(0, 10);
  if (apiLastSeenDayByUser.get(userId) === today) return;
  apiLastSeenDayByUser.set(userId, today);

  try {
    await User.createQueryBuilder()
      .update(User)
      .set({ lastSeenAt: () => 'now()' })
      .where('id = :userId', { userId })
      .andWhere(`(last_seen_at IS NULL OR last_seen_at < now() - INTERVAL '1 day')`)
      .execute();
  } catch (error) {
    // Swallowed for the same reason as `recordLastSeen`: this column is a
    // convenience and must never be why an API request reports failure.
    logger.warn({ err: error, userId }, 'Could not record API last seen');
  }
}
