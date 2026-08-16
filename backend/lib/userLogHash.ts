import { createHash } from 'node:crypto';
import { config } from '@config/config';

/**
 * A stable, pseudonymous handle for an account, for the HTTP access log.
 *
 * The gap this fills: the request log carries method, route, status, request
 * id, user agent, client IP and country -- and nothing identifying the account.
 * So "how many 429s did we serve" was answerable and "what has this account
 * been calling, and on which routes" was not, which is the question every quota
 * complaint actually asks. The one that prompted this had to be answered from
 * `AccountQuotaUsage`, a table that stores a single monthly integer and cannot
 * say what the calls were.
 *
 * Hashed rather than stored plainly because an access log is a wide-open
 * dataset by comparison with the database -- it is shipped off-box, retained on
 * its own schedule, and read by anyone debugging anything. A join key is all
 * the log needs; the identity behind it stays where identities are kept.
 *
 * NOT the email or username, at any strength. Those are the reversible
 * identifiers, and a hash of an email is famously not anonymous -- the input
 * space is a mailing list. The account id is hashed with a deployment salt, so
 * the digest is only reversible by someone who already has both the salt and
 * the user table.
 */

// 16 hex chars = 64 bits. Long enough that collisions across a few hundred
// thousand accounts stay theoretical, short enough to read in a log line and
// paste into a query.
const HASH_LENGTH = 16;

const cache = new Map<number, string>();
let cachedSalt: string | undefined;

/**
 * `salt` is a parameter rather than only a config read so the property that
 * matters -- that the digest MOVES with the salt -- is testable without
 * reaching into a sealed config object. Production callers pass nothing.
 */
export function hashUserId(userId: number, salt = config.LOG_USER_SALT): string | undefined {
  if (!salt) return undefined;

  // Entries are only valid for the salt that produced them, so a rotation
  // invalidates the cache rather than serving digests nothing can join against.
  if (salt !== cachedSalt) {
    cache.clear();
    cachedSalt = salt;
  }

  const cached = cache.get(userId);
  if (cached) return cached;

  const digest = createHash('sha256').update(`user:${userId}:${salt}`).digest('hex').slice(0, HASH_LENGTH);

  // Bounded so a scripted enumeration of ids cannot grow this without limit.
  // Dropped wholesale rather than by LRU: this is a pure function of (id, salt),
  // so a cold cache costs one hash, and the accounts that matter repopulate on
  // their next request.
  if (cache.size > 10_000) cache.clear();
  cache.set(userId, digest);

  return digest;
}
