import { describe, expect, it } from 'vitest';
import {
  CHUNK_RELOAD_MAX_ATTEMPTS,
  CHUNK_RELOAD_WINDOW_MS,
  decideChunkReload,
  parseChunkReloadGuard,
} from '~/utils/chunkReloadGuard';

describe('parseChunkReloadGuard', () => {
  it('treats a missing entry as no attempts yet', () => {
    expect(parseChunkReloadGuard(null)).toEqual({ attempts: 0, windowStartedAt: 0 });
  });

  it.each(['not json', '"a string"', 'null', '{"attempts":"two","windowStartedAt":1}'])(
    'falls back to an empty guard for %s',
    (raw) => {
      expect(parseChunkReloadGuard(raw)).toEqual({ attempts: 0, windowStartedAt: 0 });
    },
  );

  it('round-trips a persisted guard', () => {
    const guard = { attempts: 1, windowStartedAt: 1_000 };
    expect(parseChunkReloadGuard(JSON.stringify(guard))).toEqual(guard);
  });
});

describe('decideChunkReload', () => {
  it('reloads on a first error and opens the window', () => {
    expect(decideChunkReload({ attempts: 0, windowStartedAt: 0 }, 5_000)).toEqual({
      reload: true,
      guard: { attempts: 1, windowStartedAt: 5_000 },
    });
  });

  it('keeps the original window anchor while spending the budget', () => {
    expect(decideChunkReload({ attempts: 1, windowStartedAt: 5_000 }, 6_000)).toEqual({
      reload: true,
      guard: { attempts: 2, windowStartedAt: 5_000 },
    });
  });

  it('stops reloading once the budget is spent', () => {
    const guard = { attempts: CHUNK_RELOAD_MAX_ATTEMPTS, windowStartedAt: 5_000 };
    expect(decideChunkReload(guard, 6_000)).toEqual({ reload: false, guard });
  });

  it('cannot be kept alive by errors that keep arriving inside the window', () => {
    // The anchor never moves, so a client failing continuously exhausts the budget
    // instead of pushing the deadline out and reloading forever.
    let guard = { attempts: 0, windowStartedAt: 0 };
    let reloads = 0;

    for (let now = 1_000; now < 1_000 + CHUNK_RELOAD_WINDOW_MS; now += 1_000) {
      const decision = decideChunkReload(guard, now);
      guard = decision.guard;
      if (decision.reload) reloads++;
    }

    expect(reloads).toBe(CHUNK_RELOAD_MAX_ATTEMPTS);
  });

  it('allows a fresh attempt once the window has fully elapsed', () => {
    const guard = { attempts: CHUNK_RELOAD_MAX_ATTEMPTS, windowStartedAt: 5_000 };
    const now = 5_000 + CHUNK_RELOAD_WINDOW_MS;

    expect(decideChunkReload(guard, now)).toEqual({
      reload: true,
      guard: { attempts: 1, windowStartedAt: now },
    });
  });
});
