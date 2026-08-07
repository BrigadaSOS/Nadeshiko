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

export interface ChunkReloadGuard {
  attempts: number;
  windowStartedAt: number;
}

export interface ChunkReloadDecision {
  reload: boolean;
  guard: ChunkReloadGuard;
}

const EMPTY_GUARD: ChunkReloadGuard = { attempts: 0, windowStartedAt: 0 };

/** Reads the persisted guard, treating anything unparseable as "no attempts yet". */
export function parseChunkReloadGuard(raw: string | null): ChunkReloadGuard {
  if (!raw) return EMPTY_GUARD;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY_GUARD;

    const { attempts, windowStartedAt } = parsed as Partial<ChunkReloadGuard>;
    if (!Number.isFinite(attempts) || !Number.isFinite(windowStartedAt)) return EMPTY_GUARD;

    return { attempts: Number(attempts), windowStartedAt: Number(windowStartedAt) };
  } catch {
    return EMPTY_GUARD;
  }
}

/**
 * Decides whether this chunk error earns a reload, and returns the guard state to
 * persist. The window is anchored to its first attempt rather than sliding, so a
 * client failing continuously cannot keep pushing the deadline out and reload
 * forever.
 */
export function decideChunkReload(guard: ChunkReloadGuard, now: number): ChunkReloadDecision {
  // `attempts === 0` is checked explicitly rather than leaning on the epoch-0
  // anchor of an empty guard reading as "long ago" — that only holds for
  // wall-clock timestamps, and silently inverts for any smaller clock.
  const startsNewWindow = guard.attempts === 0 || now - guard.windowStartedAt >= CHUNK_RELOAD_WINDOW_MS;

  if (startsNewWindow) {
    return { reload: true, guard: { attempts: 1, windowStartedAt: now } };
  }

  if (guard.attempts >= CHUNK_RELOAD_MAX_ATTEMPTS) {
    return { reload: false, guard };
  }

  return { reload: true, guard: { attempts: guard.attempts + 1, windowStartedAt: guard.windowStartedAt } };
}
