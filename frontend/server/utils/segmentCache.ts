/**
 * A short-lived, per-process cache for the segment a permalink render needs.
 *
 * WHY THIS EXISTS. `/{locale}/sentence/{id}` is the most expensive page the site
 * serves: each render fans out to roughly four backend calls, and the corpus
 * data behind it is identical for every visitor. On 2026-08-09 a few thousand
 * visitor requests turned into 31,422 internal ones and took production down.
 * The rate-limit and retry defects that made that possible are fixed; this
 * closes the third side of it, by making the render cheap rather than merely
 * survivable.
 *
 * TWO PROPERTIES, AND THE SECOND IS THE IMPORTANT ONE:
 *
 * 1. Repeat renders of the same sentence within the TTL cost nothing.
 * 2. *Concurrent* renders of the same sentence collapse into ONE backend call.
 *    A burst on a single popular (or targeted) permalink is precisely the shape
 *    that hurt, and a plain TTL cache does nothing for it — every request in the
 *    burst arrives before the first answer lands, so every one is a miss. The
 *    inflight map is what turns a thousand simultaneous renders into one call.
 *
 * Deliberately NOT a `routeRules` entry. Route rules only apply to requests
 * Nitro serves, and the SSR path does not go through Nitro: `createInternalSdk`
 * builds a client against `NUXT_BACKEND_INTERNAL_URL` and calls
 * `api.nadeshiko.co` directly. A route rule would cache the browser-facing proxy
 * and leave the flood untouched.
 *
 * Modelled on `ssrAuthCache.ts`, which solves the same problem for the session
 * lookup. Per-process, so there are NITRO_CLUSTER_WORKERS copies and a deploy
 * empties them — both acceptable, because this is an optimisation and never a
 * source of truth.
 *
 * THE KEY IS THE SEGMENT ID AND NOTHING ELSE, WHICH IS ONLY SAFE BECAUSE OF
 * WHAT IS CACHED. `getSegment` is on the generated public-route allowlist
 * (`server/utils/generated/publicApiRoutes.ts`): it is corpus data, signed with
 * the service credential, and identical for every visitor. One entry shared by
 * everyone is correct.
 *
 * That stops being true the moment this is pointed at an owner-scoped call.
 * Anything reading a user's own data needs the reader's identity IN THE KEY, or
 * the first visitor's response is served to the next one — which is a data
 * leak, not a stale page. Note also that the SSR SDK is moving to choosing its
 * credential per route rather than per call-site, so "which identity did this
 * response belong to" becomes a property of the path being fetched. Check that
 * before adding a second call here.
 */

/** Five minutes. This is the window in which an edited segment keeps serving
 *  its old text, which is why it is minutes and not hours: revisions are a
 *  contributor-facing feature and a correction that takes an hour to appear
 *  reads as a bug. Renders of a given sentence cluster in time, so most of the
 *  benefit is in the first seconds anyway. */
const TTL_MS = 5 * 60 * 1000;

/** The corpus has far more segments than any process should hold. The cap is a
 *  backstop against a crawler walking the whole corpus and turning this into a
 *  slow memory leak; ordinary traffic never approaches it. */
const MAX_ENTRIES = 2_000;

type Entry<T> = { kind: 'inflight'; promise: Promise<T> } | { kind: 'value'; value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

function gc(now: number): void {
  for (const [k, e] of store) {
    if (e.kind === 'value' && e.expiresAt <= now) store.delete(k);
  }

  // Still over after dropping what expired: evict oldest-first. Map preserves
  // insertion order, so the head is the least recently *added* entry. Not a
  // true LRU, and deliberately not — a hot segment being re-added on expiry is
  // the common case, and the accounting an LRU needs is not worth it here.
  if (store.size > MAX_ENTRIES) {
    for (const k of store.keys()) {
      if (store.size <= MAX_ENTRIES) break;
      store.delete(k);
    }
  }
}

/**
 * Run `fetcher` for `publicId`, reusing a fresh answer or an in-flight one.
 *
 * The fetcher is supplied by the caller rather than built here so that SDK
 * construction stays in one place (`useNadeshikoSdk`), and so this stays
 * testable without a backend.
 *
 * Errors are never cached, and a failed call clears its inflight entry, so a
 * backend blip cannot pin a permalink to an error for the rest of the TTL.
 * That includes 404s: caching "does not exist" would let a mistyped or
 * enumerated ID occupy an entry, and it would make a newly published segment
 * invisible for five minutes for no gain.
 */
export async function cachedSegment<T>(publicId: string, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  gc(now);

  const existing = store.get(publicId);
  if (existing?.kind === 'value' && existing.expiresAt > now) return existing.value as T;
  if (existing?.kind === 'inflight') return existing.promise as Promise<T>;

  const promise = (async () => {
    try {
      const value = await fetcher();
      store.set(publicId, { kind: 'value', value, expiresAt: Date.now() + TTL_MS });
      return value;
    } catch (error) {
      store.delete(publicId);
      throw error;
    }
  })();

  store.set(publicId, { kind: 'inflight', promise });
  return promise;
}

/** Test-only -- DO NOT call from prod code. */
export function _resetForTests(): void {
  store.clear();
}
