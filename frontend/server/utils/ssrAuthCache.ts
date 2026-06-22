import { createHash } from 'node:crypto';
import { getCookie, getRequestHeader } from 'h3';
import type { H3Event } from 'h3';

const SESSION_COOKIE = 'nadeshiko.session_token';
const SESSION_COOKIE_PREFIXES = ['', '__Secure-', '__Host-'] as const;
const TTL_MS = 30_000;
const MAX_KEY_LEN = 128;

type Entry<T> =
  | { kind: 'inflight'; promise: Promise<T> }
  | { kind: 'value'; value: T; expiresAt: number };

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

function getAnonKey(event: H3Event): string {
  // Mirror h3's getRequestIP({ xForwardedFor: true }) without depending on
  // event.context (Cloudflare always sets X-Forwarded-For).
  const xForwardedFor = getRequestHeader(event, 'x-forwarded-for')?.split(',').shift()?.trim();
  const ip = xForwardedFor || event.node?.req?.socket?.remoteAddress || 'unknown';
  return `anon:${ip}`;
}

function cacheKey(event: H3Event): string {
  const sk = getSessionKey(event);
  return (sk ?? getAnonKey(event)).slice(0, MAX_KEY_LEN);
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
