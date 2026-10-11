import { createHash } from 'node:crypto';
import { config } from '@config/config';

/** Hash account IDs with a deployment salt for a stable access-log join key without exposing email/username; logs
 * leave the database, while identity remains in the user table. */

// Use 64 bits: readable in logs while collisions across the account population remain unlikely.
const HASH_LENGTH = 16;

const cache = new Map<number, string>();
let cachedSalt: string | undefined;

/** Accept salt as an argument so tests prove the digest changes with salt; production callers use config. */
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

  // Bound the pure-function cache; evict wholesale because misses cost one hash and entries repopulate.
  if (cache.size > 10_000) cache.clear();
  cache.set(userId, digest);

  return digest;
}
