/**
 * Loop protection for the `app:chunkError` recovery reload.
 *
 * Nuxt's own `reloadNuxtApp` guard is keyed by path with a 10s TTL, which does
 * not hold here: the sessions this recovers from fail across several routes in a
 * row, so every new path would earn a fresh reload allowance. This guard counts
 * attempts across all paths inside one rolling window instead, so a client stuck
 * on a genuinely broken build stops reloading and surfaces the error rather than
 * spinning.
 */

export const CHUNK_RELOAD_STORAGE_KEY = 'nadeshiko:chunk-reload';
export const CHUNK_RELOAD_MAX_ATTEMPTS = 2;
export const CHUNK_RELOAD_WINDOW_MS = 10 * 60_000;

/**
 * How long one decision keeps counting as the same failure.
 *
 * THE BUDGET IS SPENT PER RELOAD, NOT PER REJECTION, and this is the constant
 * that makes that true. A stale page does not fail once: it fails once per chunk
 * it cannot fetch, and they all reject within a frame or two of each other.
 * Production, 2026-08-13, one reader in one tick:
 *
 *   17:34:25.937  Cjcbm_ko2.js
 *   17:34:25.940  pYzpkj1_2.js
 *   17:34:26.042  DrC9mS-I2.js
 *
 * Billed individually those three spend the entire two-attempt allowance in
 * 105ms, so the reader got ONE reload out of a budget written to give them two,
 * and the surplus rejections were filed as `app:chunk-error-unrecoverable`
 * before the reload they were complaining about had even happened. Every sampled
 * event in that issue was one of these -- the error was, in effect, reporting
 * itself.
 *
 * A second is far longer than a burst and far shorter than a reload, so it
 * cannot merge two genuine attempts: by the time the document has been replaced
 * and its chunks have failed again, this window is long gone.
 */
export const CHUNK_RELOAD_BURST_MS = 1_000;

/**
 * How each engine words a failed `import()` of a module it could not fetch.
 *
 * Needed because not every orphaned chunk arrives through `app:chunkError`.
 * Nuxt raises that hook from `vite:preloadError`, which Vite only emits for
 * imports it wrapped in its preload helper -- route chunks. The LAYOUT chunks in
 * `virtual:nuxt:/app/.nuxt/layouts.mjs` are a plain `() => import(...)`, so when
 * one of those 404s after a deploy the promise just rejects: no Vite event, no
 * Nuxt hook, no recovery. That was the whole of this error in production --
 * 345 occurrences across 26 readers in the fortnight to 2026-08-11, and not one
 * `app:chunk-error-*` report beside them, because the hook never ran.
 *
 * Matched on the message rather than the type: all three are a bare `TypeError`.
 */
const CHUNK_LOAD_MESSAGES = [
  'failed to fetch dynamically imported module', // Chromium
  'error loading dynamically imported module', // Firefox
  'importing a module script failed', // Safari
];

/**
 * Whether a rejection is a module that could not be fetched, rather than any
 * other `TypeError`. Deliberately narrow: a false positive here reloads the tab
 * out from under someone over an unrelated failure.
 */
export function isChunkLoadError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : String((error as any)?.message ?? '');

  const normalized = message.toLowerCase();
  return CHUNK_LOAD_MESSAGES.some((phrase) => normalized.includes(phrase));
}

export interface ChunkReloadGuard {
  attempts: number;
  windowStartedAt: number;
  /**
   * When the most recent attempt was spent, which is what lets the rejections
   * behind one broken page load be recognised as one failure. See
   * `CHUNK_RELOAD_BURST_MS`.
   */
  lastAttemptAt: number;
}

/**
 * What to do about this rejection.
 *
 * `pending` exists so that "a reload is already on its way" is not confused with
 * "this client is beyond help". Both decline to reload; only one of them is
 * worth waking somebody up about, and conflating them is what filled the issue
 * with reports of a recovery that was working.
 */
export type ChunkReloadAction = 'reload' | 'pending' | 'exhausted';

export interface ChunkReloadDecision {
  action: ChunkReloadAction;
  guard: ChunkReloadGuard;
}

const EMPTY_GUARD: ChunkReloadGuard = { attempts: 0, windowStartedAt: 0, lastAttemptAt: 0 };

/** Reads the persisted guard, treating anything unparseable as "no attempts yet". */
export function parseChunkReloadGuard(raw: string | null): ChunkReloadGuard {
  if (!raw) return EMPTY_GUARD;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY_GUARD;

    const { attempts, windowStartedAt, lastAttemptAt } = parsed as Partial<ChunkReloadGuard>;
    if (!Number.isFinite(attempts) || !Number.isFinite(windowStartedAt)) return EMPTY_GUARD;

    return {
      attempts: Number(attempts),
      windowStartedAt: Number(windowStartedAt),
      // Absent in guards written before the burst window existed, and in a tab
      // that was mid-recovery across the deploy that introduced it. Falling back
      // to the window anchor is the conservative reading -- it can only make a
      // burst look older than it was, which costs an extra attempt rather than
      // suppressing a real report.
      lastAttemptAt: Number.isFinite(lastAttemptAt) ? Number(lastAttemptAt) : Number(windowStartedAt),
    };
  } catch {
    return EMPTY_GUARD;
  }
}

/**
 * Decides what this chunk error earns, and returns the guard state to persist.
 *
 * Two windows, doing opposite jobs. `CHUNK_RELOAD_WINDOW_MS` is the outer one:
 * anchored to its first attempt rather than sliding, so a client failing
 * continuously cannot keep pushing the deadline out and reload forever.
 * `CHUNK_RELOAD_BURST_MS` is the inner one, and it stops a single broken page
 * load from being charged once per chunk it could not fetch.
 */
export function decideChunkReload(guard: ChunkReloadGuard, now: number): ChunkReloadDecision {
  // Everything still arriving from the page load that triggered the last attempt
  // is that same failure. Checked FIRST, because it holds whether or not the
  // budget has anything left -- the last rejection of a burst that just spent the
  // final attempt is still not evidence that the reload failed. It has not
  // happened yet.
  if (guard.attempts > 0 && now - guard.lastAttemptAt < CHUNK_RELOAD_BURST_MS) {
    return { action: 'pending', guard };
  }

  // `attempts === 0` is checked explicitly rather than leaning on the epoch-0
  // anchor of an empty guard reading as "long ago" — that only holds for
  // wall-clock timestamps, and silently inverts for any smaller clock.
  const startsNewWindow = guard.attempts === 0 || now - guard.windowStartedAt >= CHUNK_RELOAD_WINDOW_MS;

  if (startsNewWindow) {
    return { action: 'reload', guard: { attempts: 1, windowStartedAt: now, lastAttemptAt: now } };
  }

  if (guard.attempts >= CHUNK_RELOAD_MAX_ATTEMPTS) {
    return { action: 'exhausted', guard };
  }

  return {
    action: 'reload',
    guard: { attempts: guard.attempts + 1, windowStartedAt: guard.windowStartedAt, lastAttemptAt: now },
  };
}
