import { describe, expect, it } from 'vitest';
import {
  CHUNK_RELOAD_MAX_ATTEMPTS,
  CHUNK_RELOAD_WINDOW_MS,
  decideChunkReload,
  isChunkLoadError,
  parseChunkReloadGuard,
} from '~/utils/chunkReloadGuard';

describe('isChunkLoadError', () => {
  // The three real messages, because the engines do not agree on any substring
  // longer than "module" and matching that alone would be far too loose.
  it.each([
    ['Chromium', 'Failed to fetch dynamically imported module: https://nadeshiko.co/_nuxt/DlAUqK2U.js'],
    ['Firefox', 'error loading dynamically imported module: https://nadeshiko.co/_nuxt/DlAUqK2U.js'],
    ['Safari', 'Importing a module script failed.'],
  ])('recognises the %s wording', (_engine, message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it('reads a rejection that is a bare string rather than an Error', () => {
    expect(isChunkLoadError('Failed to fetch dynamically imported module: /_nuxt/x.js')).toBe(true);
  });

  // The reason this predicate is narrow: everything below is also a TypeError,
  // and reloading the tab on any of them would throw away the reader's page for
  // a failure a reload cannot fix.
  it.each([
    ['a plain network failure', new TypeError('Failed to fetch')],
    ['an unrelated dereference', new TypeError("Cannot read properties of undefined (reading 'result')")],
    ['an aborted request', new DOMException('The operation was aborted.', 'AbortError')],
  ])('does not claim %s', (_label, error) => {
    expect(isChunkLoadError(error)).toBe(false);
  });

  it.each([[null], [undefined], [{}]])('survives %s without throwing', (value) => {
    expect(isChunkLoadError(value)).toBe(false);
  });
});

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
