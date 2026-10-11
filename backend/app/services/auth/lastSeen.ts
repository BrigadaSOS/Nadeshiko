/** After-hook bookkeeping must never fail sign-in: log and swallow errors after the session is already committed. */

import { User } from '@app/models/User';
import { logger } from '@config/log';

/** An absent country means “leave the stored value alone,” not “clear it”; no header is not evidence of a new
 * location. */
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

/** Do not record an impersonated admin session as activity by the impersonated account. */
export interface SessionLike {
  userId?: unknown;
  impersonatedBy?: unknown;
}

/** Named predicate for the session rule; keeping it in one place prevents the two hooks from drifting. */
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

/** Replace each account's API-active day rather than accumulating dates, so this process-local map stays bounded. */
const apiLastSeenDayByUser = new Map<number, string>();

/** API-key activity is throttled by a database-day guard as well as a process-local cache; do not write
 * `last_seen_country` from API traffic. */
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
