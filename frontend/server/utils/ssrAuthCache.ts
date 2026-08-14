import { createHash } from 'node:crypto';
import { getCookie } from 'h3';
import type { H3Event } from 'h3';

const SESSION_COOKIE = 'nadeshiko.session_token';
const SESSION_COOKIE_PREFIXES = ['', '__Secure-', '__Host-'] as const;
const TTL_MS = 30_000;
const MAX_KEY_LEN = 128;

/**
 * Stamped by the `/v1` proxy when it forwards a write that rewrites the
 * preferences column, and folded into the cache key below.
 *
 * Deleting the entry instead would only have worked here, in the process that
 * happened to serve the write. Production runs `node_cluster` with
 * `NITRO_CLUSTER_WORKERS: 3`, and this `Map` is per worker, so the next render
 * has two chances in three of landing on a worker that still holds the old
 * preferences -- which is exactly the "I saved it, refreshed, and it came back
 * wrong" the merged cache produced in the first place. A cookie rides on the
 * request instead, so every worker and every replica computes a key it has
 * never seen and goes and asks.
 *
 * Its lifetime only has to outlast `TTL_MS`: once the stale entry has expired
 * on its own there is nothing left to miss past, and the key returns to the
 * plain session one.
 */
export const PREFS_VERSION_COOKIE = 'nd-prefs-version';

/**
 * Derived from `TTL_MS` rather than written out, because the relationship is the
 * whole correctness argument and a hardcoded number would let the two drift
 * silently. The stamp only has to outlive the entry it is steering readers away
 * from: once that has expired on its own there is nothing left to miss past, and
 * the key goes back to the plain session one. Doubled for clock slop.
 */
export const PREFS_VERSION_MAX_AGE_S = Math.ceil((TTL_MS / 1000) * 2);

/**
 * The shape this module mints: `Date.now()`, so digits and at most 13 of them.
 *
 * Checked rather than trusted because the value decides which cache entry is
 * read, and it arrives on a cookie. Rejecting anything else keeps a client from
 * minting unbounded distinct keys out of arbitrary strings -- each of which
 * would cost a backend round trip and an entry held for `TTL_MS`.
 */
const PREFS_VERSION_RE = /^\d{1,13}$/;

type Entry<T> = { kind: 'inflight'; promise: Promise<T> } | { kind: 'value'; value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 32);
}

function getSessionKey(event: H3Event): string | null {
  for (const prefix of SESSION_COOKIE_PREFIXES) {
    const name = `${prefix}${SESSION_COOKIE}`;
    const v = getCookie(event, name);
    if (v) return `${prefix || 'plain'}:${hashToken(v)}`;
  }
  return null;
}

function cacheKey(event: H3Event): string {
  // Session cookie, plus the preferences stamp when the reader has just changed
  // something. There used to be an anonymous fallback keyed on client IP, from
  // when this cache saw every render; `identity-auth` now returns before
  // reaching here when the request carries no session cookie, so that branch
  // became unreachable -- and with it this module's only reason to know a
  // visitor's IP address.
  const sk = getSessionKey(event) ?? 'anonymous';
  const version = getCookie(event, PREFS_VERSION_COOKIE);
  const stamp = version && PREFS_VERSION_RE.test(version) ? version : null;
  return (stamp ? `${sk}#${stamp}` : sk).slice(0, MAX_KEY_LEN);
}

/**
 * Whether this request carries a session cookie at all.
 *
 * The SSR bootstrap used to ask the backend who the visitor was on every render,
 * including the renders where the request carried no session cookie -- and a
 * request with no session cookie has exactly one possible answer. The cache below
 * absorbed bursts from one address, but a crawler sweeping the corpus arrives from
 * a different IP each time and every one of those renders paid a round trip, in
 * the critical path, to be told what the absent cookie already said.
 *
 * Exported rather than folded into `ssrAuthFetch` so the caller can skip building
 * the request at all, and so the same cookie names are recognised in one place.
 */
export function hasSessionCookie(event: H3Event): boolean {
  return getSessionKey(event) !== null;
}

function gc(now: number): void {
  for (const [k, e] of store) {
    if (e.kind === 'value' && e.expiresAt <= now) store.delete(k);
  }
}

export async function ssrAuthFetch<T>(event: H3Event, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  gc(now);
  const key = cacheKey(event);
  const existing = store.get(key);

  if (existing?.kind === 'value' && existing.expiresAt > now) {
    return existing.value as T;
  }
  if (existing?.kind === 'inflight') {
    return existing.promise as Promise<T>;
  }

  const promise = (async () => {
    try {
      const value = await fetcher();
      store.set(key, { kind: 'value', value, expiresAt: Date.now() + TTL_MS });
      return value;
    } catch (err) {
      store.delete(key); // do not cache errors
      throw err;
    }
  })();
  store.set(key, { kind: 'inflight', promise });
  return promise;
}

/**
 * Forgets everything this worker holds for the session on `event`, stamped or
 * not.
 *
 * The second half of the invalidation, and it exists because the stamp is a
 * cookie: it can only reach renders made by the browser that did the writing.
 * Anything arriving on a fresh cookie jar -- another browser, a private window,
 * a test that builds a context per case -- computes the plain session key and is
 * handed the pre-change entry until it expires on its own.
 *
 * Dropping it here fixes exactly that, for exactly this worker. Production forks
 * three, so this is not a substitute for the stamp -- it is the half that covers
 * the cookie-less caller, while the stamp is the half that crosses workers.
 */
export function dropSessionEntries(event: H3Event): void {
  const sk = getSessionKey(event);
  if (!sk) return;

  const prefix = `${sk}#`;
  for (const key of store.keys()) {
    if (key === sk || key.startsWith(prefix)) store.delete(key);
  }
}

export function _resetForTests(): void {
  store.clear();
}
