import { createHash } from 'node:crypto';
import { metrics } from '@opentelemetry/api';
import { getCookie } from 'h3';
import type { H3Event } from 'h3';

export const SESSION_COOKIE = 'nadeshiko.session_token';

export const SESSION_COOKIE_PREFIXES = ['', '__Secure-', '__Host-'] as const;
// Coalesce SSR session reads to avoid exhausting the backend auth limiter on the proxy's shared IP.
const TTL_MS = 60_000;
const MAX_KEY_LEN = 128;

// A successful identity write stamps the browser's cache key so it misses across processes and overlapping deploys.
// Local entry deletion alone cannot invalidate another process's store.
export const PREFS_VERSION_COOKIE = 'nd-prefs-version';

// Outlive cached entries, with clock slop; deriving the lifetime from TTL_MS prevents drift.
export const PREFS_VERSION_MAX_AGE_S = Math.ceil((TTL_MS / 1000) * 2);

// Restrict cookie input to timestamp-shaped preference stamps before incorporating it into cache keys.
const PREFS_VERSION_RE = /^\d{1,13}$/;

type Entry<T> = { kind: 'inflight'; promise: Promise<T> } | { kind: 'value'; value: T; expiresAt: number };

// Share one store across the Vue SSR and Nitro bundles; module-local maps would be duplicated.
// Symbol.for gives both bundles the same per-process key so proxy invalidation clears the store SSR reads.
const STORE_KEY = Symbol.for('nadeshiko.ssrAuthCache.store');

type GlobalWithStore = typeof globalThis & { [STORE_KEY]?: Map<string, Entry<unknown>> };

const globalWithStore = globalThis as GlobalWithStore;

if (!globalWithStore[STORE_KEY]) {
  globalWithStore[STORE_KEY] = new Map<string, Entry<unknown>>();
}
const store: Map<string, Entry<unknown>> = globalWithStore[STORE_KEY];

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

// Scopes separate response shapes for the same session. Callers sharing a scope must share a return type.
export type SsrAuthScope = 'identity' | 'shirabe';

type SsrAuthOutcome = 'hit' | 'coalesced' | 'miss' | 'anonymous';

// Resolve the meter after instrumentation registers its provider. Scope and hit/coalesced/miss labels
// distinguish backend round trips from cache savings and anonymous renders.
const meter = metrics.getMeter('nadeshiko-frontend');

const lookups = meter.createCounter('ssr.auth_cache.lookups', {
  description: 'SSR identity cache lookups by outcome',
  unit: '{lookup}',
});

function recordLookup(outcome: SsrAuthOutcome, scope: SsrAuthScope): void {
  lookups.add(1, { outcome, scope });
}

// Count at the render decision, not in hasSessionCookie: several callers use that predicate per request.
export function recordAnonymousRender(scope: SsrAuthScope = 'identity'): void {
  recordLookup('anonymous', scope);
}

function cacheKey(event: H3Event, scope: SsrAuthScope): string {
  const sk = getSessionKey(event) ?? 'anonymous';
  const version = getCookie(event, PREFS_VERSION_COOKIE);
  const stamp = version && PREFS_VERSION_RE.test(version) ? version : null;
  return `${scope}:${stamp ? `${sk}#${stamp}` : sk}`.slice(0, MAX_KEY_LEN);
}

// Let callers skip building a backend request when no session cookie exists.
export function hasSessionCookie(event: H3Event): boolean {
  return getSessionKey(event) !== null;
}

function gc(now: number): void {
  for (const [k, e] of store) {
    if (e.kind === 'value' && e.expiresAt <= now) store.delete(k);
  }
}

export async function ssrAuthFetch<T>(
  event: H3Event,
  fetcher: () => Promise<T>,
  // Different response shapes require different scopes.
  scope: SsrAuthScope = 'identity',
): Promise<T> {
  const now = Date.now();
  gc(now);
  const key = cacheKey(event, scope);
  const existing = store.get(key);

  if (existing?.kind === 'value' && existing.expiresAt > now) {
    recordLookup('hit', scope);
    return existing.value as T;
  }
  if (existing?.kind === 'inflight') {
    recordLookup('coalesced', scope);
    return existing.promise as Promise<T>;
  }

  // Count before awaiting so failed backend calls still register as misses.
  recordLookup('miss', scope);

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

// Invalidate every entry for this session in this process, including callers without a preference stamp.
// The browser stamp complements this by covering other processes.
export function dropSessionEntries(event: H3Event): void {
  const sk = getSessionKey(event);
  if (!sk) return;

  for (const key of store.keys()) {
    const withoutScope = key.slice(key.indexOf(':') + 1);
    if (withoutScope === sk || withoutScope.startsWith(`${sk}#`)) store.delete(key);
  }
}

export function _resetSsrAuthCacheForTests(): void {
  store.clear();
}
