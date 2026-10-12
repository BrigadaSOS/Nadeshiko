/**
 * Count recovery attempts across routes; Nuxt's per-path guard would grant a fresh allowance on each
 * navigation.
 */

export const CHUNK_RELOAD_STORAGE_KEY = 'nadeshiko:chunk-reload';
export const CHUNK_RELOAD_MAX_ATTEMPTS = 2;
export const CHUNK_RELOAD_WINDOW_MS = 10 * 60_000;

/**
 * Charge one reload per burst, not one attempt per rejected chunk. A one-second window groups failures from
 * the same stale document.
 */
export const CHUNK_RELOAD_BURST_MS = 1_000;

/**
 * Match engine-specific import-failure messages because layout imports can reject outside Nuxt's chunk-error
 * hook. TypeError alone is too broad.
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
 * Pending and exhausted both decline reload, but only exhaustion means recovery failed and warrants
 * reporting.
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
      // Older guards lack `lastAttemptAt`; use the window anchor, which may spend an extra attempt but will
      // not suppress a real failure.
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
  // Check the burst before exhaustion: later chunks from the same document do not prove that its pending
  // reload failed.
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
