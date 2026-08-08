import { createHash } from 'node:crypto';
import { getCookie } from 'h3';
import type { H3Event } from 'h3';

const SESSION_COOKIE = 'nadeshiko.session_token';
const SESSION_COOKIE_PREFIXES = ['', '__Secure-', '__Host-'] as const;
const TTL_MS = 30_000;
const MAX_KEY_LEN = 128;

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
  // Session cookie only. There used to be an anonymous fallback keyed on client
  // IP, from when this cache saw every render; `identity-auth` now returns before
  // reaching here when the request carries no session cookie, so that branch
  // became unreachable -- and with it this module's only reason to know a
  // visitor's IP address.
  const sk = getSessionKey(event);
  return (sk ?? 'anonymous').slice(0, MAX_KEY_LEN);
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

export function _resetForTests(): void {
  store.clear();
}
