import { createHash } from 'node:crypto';
import { metrics } from '@opentelemetry/api';
import { getCookie } from 'h3';
import type { H3Event } from 'h3';

export const SESSION_COOKIE = 'nadeshiko.session_token';
// Exported for `sessionCookieRenewal`, which has to recognise the same cookie
// on the way back out.
export const SESSION_COOKIE_PREFIXES = ['', '__Secure-', '__Host-'] as const;
// 60s (was 30s): the backend's per-IP rate limiter on /v1/auth/* rejects the
// frontend's own SSR `get-session` calls under sustained render load (every
// render shares the proxy's source IP). Caching the answer for a minute turns
// N concurrent renders of one reader's session into 1 backend round trip
// instead of N, which keeps the request rate below the limiter's per-window
// budget. The window matches what the session itself accepts; preference edits
// happen client-side and re-render without touching the server.
const TTL_MS = 60_000;
const MAX_KEY_LEN = 128;

/**
 * Stamped by the `/v1` proxy when it forwards a write that rewrites the
 * preferences column, and folded into the cache key below.
 *
 * Deleting the entry instead only works in the process that served the write. A
 * cookie rides on the request instead, so ANY process computes a key it has
 * never seen and goes and asks.
 *
 * PRODUCTION IS ONE PROCESS TODAY, and the comments here used to say otherwise
 * -- "node_cluster with NITRO_CLUSTER_WORKERS: 3", "two chances in three of
 * landing on a worker that still holds the old preferences". That was never
 * true of the running service and it sent at least one reviewer hunting a
 * sharding bug that does not exist. `config/deploy.prod.yml` does set
 * `NITRO_PRESET: node_cluster` and `NITRO_CLUSTER_WORKERS: 3`, but Nitro bakes
 * its preset in at BUILD time and `nuxt.config.ts` hardcodes
 * `preset: 'node-server'`, so both variables are inert -- the same trap
 * `ipRateLimit.ts` documents at length after it cost that file a real bug.
 * Verified 2026-08-23: `.output/nitro.json` reports `"preset": "node-server"`,
 * and a live response advertises `x-ratelimit-limit: 60`, which is
 * `perWorkerMax(60)` with `workerCount() === 1`. One host in `deploy.yml`, so
 * one replica as well.
 *
 * The stamp stays anyway, and not out of superstition. It is what makes the
 * guarantee independent of how many processes are running, and the settings
 * that would fork three of them are already sitting in the deploy file --
 * correcting that one hardcoded preset would restore the multi-worker case
 * overnight, with nothing here to notice. Deploys also overlap: Kamal boots the
 * new container before retiring the old, so a write served by one and a render
 * by the other is two stores for the length of a cutover.
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

/**
 * Held on `globalThis`, not in a module-level `const`, because this module is
 * imported from both sides of a bundle boundary and a plain `const` is therefore
 * TWO maps.
 *
 * `ssrAuthFetch` is called from `app/plugins/identity-auth.ts`, which is app
 * code compiled into the Vue SSR bundle. `dropSessionEntries` is called from
 * `server/utils/backendProxy.ts`, which is server code compiled into the Nitro
 * bundle. Each build inlines its own copy of this module, so before this the
 * proxy was deleting entries out of a map nothing ever read: a reader whose
 * request carried no `nd-prefs-version` stamp -- a second browser, a private
 * window, a Playwright context built per test -- kept being handed pre-change
 * preferences for the rest of `TTL_MS`, which is precisely the case the drop
 * exists to cover. The stamp hid it, because a cookie changes the key on
 * whichever copy computes it.
 *
 * `Symbol.for` rather than a string property: it is keyed in the cross-realm
 * registry, so both copies resolve the same symbol without a name that could
 * collide with anything else parked on the global.
 *
 * This is per process, which is all it ever was. Today that is the whole
 * service (one host, one un-forked `node-server` process -- see
 * `PREFS_VERSION_COOKIE`), so the two bundle copies sharing this map is the
 * entire sharing problem; the stamp is what would keep covering it if that
 * stopped being true.
 */
const STORE_KEY = Symbol.for('nadeshiko.ssrAuthCache.store');

type GlobalWithStore = typeof globalThis & { [STORE_KEY]?: Map<string, Entry<unknown>> };

const globalWithStore = globalThis as GlobalWithStore;
// Split off the `??=` rather than assigning inside the initializer: biome's
// noAssignInExpressions is an error here, and the two-step form says the same
// thing -- reuse the store this process already parked on the global, or park
// one now.
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

/**
 * What a cached answer is FOR, as well as whose it is.
 *
 * The scope is not decoration. This cache is keyed on the session cookie, and
 * for a long time on nothing else -- so two callers asking two different
 * questions about the same reader shared one slot and read each other's
 * answers. `identity-auth` stores `{session, preferences, reachedBackend}` and
 * `shirabeReader` stores the raw `{user}` of a get-session; whichever ran first
 * won, and the loser read a shape it did not recognise.
 *
 * It failed silently and completely: the SSR render always runs first, so every
 * word lookup for the next minute found no `user.shirabe` in a preferences
 * bundle, concluded the reader had linked nothing, and answered from the shared
 * cache with the default dictionaries. Nothing threw, nothing logged, and a
 * reader who had linked their account never once saw their own dictionaries.
 *
 * A caller that shares a scope must share a return type. Nothing enforces that
 * beyond this comment, so a new caller wants a new scope unless it is genuinely
 * asking the same question.
 */
export type SsrAuthScope = 'identity' | 'shirabe';

/**
 * What happened to one lookup.
 *
 * - `hit` — a stored value was still inside the TTL. No backend call.
 * - `coalesced` — a build for this exact key was already in flight and this
 *   caller joined it. Also no backend call, but it is a CONCURRENT render rather
 *   than a later one, so it counts a different thing and is worth its own label:
 *   the two together are what the cache saves, and their ratio says whether the
 *   TTL or the in-flight dedup is doing the work.
 * - `miss` — the fetcher ran. One backend round trip on a render's critical path.
 * - `anonymous` — no session cookie, so `identity-auth` returned before reaching
 *   the cache at all.
 */
type SsrAuthOutcome = 'hit' | 'coalesced' | 'miss' | 'anonymous';

/**
 * WITHOUT THIS, EVERY SIGNED-IN LATENCY NUMBER THIS PROJECT HAS IS A MISS.
 *
 * A cache hit and a render with no session cookie were indistinguishable from
 * outside: both are fast, neither logs, and nothing counted either. So a render
 * sampled as "signed in" could only ever be one that MISSED -- a hit is
 * unmarked, and nothing here has ever reported what share of signed-in renders
 * that is. Until these series have run for a while, treat every signed-in
 * latency figure in this project (342ms warm / 436ms cold for search) as
 * describing misses, and do not assume it describes the population.
 *
 * At most eight series, five in practice: `anonymous` is only ever recorded for
 * `identity`, since it is the render path that has an anonymous case at all.
 * `scope` is on the counter because the two callers have completely different
 * shapes of traffic -- `identity` is once per render, `shirabe` is once per word
 * lookup -- and averaging them answers neither question.
 *
 * The meter is resolved at module load, which is safe here: the container starts
 * `node --import ./instrumentation.mjs`, so the SDK has registered a real
 * MeterProvider long before anything imports this file. Resolved before that it
 * would silently be a no-op for the life of the process.
 */
const meter = metrics.getMeter('nadeshiko-frontend');

const lookups = meter.createCounter('ssr.auth_cache.lookups', {
  description: 'SSR identity cache lookups by outcome',
  unit: '{lookup}',
});

function recordLookup(outcome: SsrAuthOutcome, scope: SsrAuthScope): void {
  lookups.add(1, { outcome, scope });
}

/**
 * Counts the renders that never reach the cache because the request carried no
 * session cookie.
 *
 * Exported rather than folded into `hasSessionCookie` because that predicate has
 * three callers asking three different questions (`identity-auth`,
 * `shirabeReader`, `visitorCacheTier`) and counting inside it would report one
 * render up to three times. The one caller that decides whether a render is
 * anonymous is the one that calls this.
 */
export function recordAnonymousRender(scope: SsrAuthScope = 'identity'): void {
  recordLookup('anonymous', scope);
}

function cacheKey(event: H3Event, scope: SsrAuthScope): string {
  // Session cookie, plus the preferences stamp when the reader has just changed
  // something. There used to be an anonymous fallback keyed on client IP, from
  // when this cache saw every render; `identity-auth` now returns before
  // reaching here when the request carries no session cookie, so that branch
  // became unreachable -- and with it this module's only reason to know a
  // visitor's IP address.
  const sk = getSessionKey(event) ?? 'anonymous';
  const version = getCookie(event, PREFS_VERSION_COOKIE);
  const stamp = version && PREFS_VERSION_RE.test(version) ? version : null;
  return `${scope}:${stamp ? `${sk}#${stamp}` : sk}`.slice(0, MAX_KEY_LEN);
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

export async function ssrAuthFetch<T>(
  event: H3Event,
  fetcher: () => Promise<T>,
  /** What this answer is for. Callers storing different shapes MUST pass
   *  different scopes -- see `SsrAuthScope`. */
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

  // Counted here rather than after the fetcher settles, so a miss is recorded
  // even when the backend call throws -- an auth outage must show as misses, not
  // as a counter that goes quiet.
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
 * Dropping it here fixes exactly that, for exactly this process -- which, while
 * production runs a single un-forked one, happens to mean every render. That is
 * a fact about today's deployment and not a property of this function, so it is
 * still not a substitute for the stamp: this is the half that covers the
 * cookie-less caller, and the stamp is the half that survives a second process.
 */
export function dropSessionEntries(event: H3Event): void {
  const sk = getSessionKey(event);
  if (!sk) return;

  // Every scope, since they all describe the same reader and a preference change
  // can move any of them.
  for (const key of store.keys()) {
    const withoutScope = key.slice(key.indexOf(':') + 1);
    if (withoutScope === sk || withoutScope.startsWith(`${sk}#`)) store.delete(key);
  }
}

export function _resetSsrAuthCacheForTests(): void {
  store.clear();
}
