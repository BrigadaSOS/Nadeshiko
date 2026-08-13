import { describe, expect, it } from 'vitest';
import {
  CHUNK_RELOAD_BURST_MS,
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
    expect(parseChunkReloadGuard(null)).toEqual({ attempts: 0, windowStartedAt: 0, lastAttemptAt: 0 });
  });

  it.each(['not json', '"a string"', 'null', '{"attempts":"two","windowStartedAt":1}'])(
    'falls back to an empty guard for %s',
    (raw) => {
      expect(parseChunkReloadGuard(raw)).toEqual({ attempts: 0, windowStartedAt: 0, lastAttemptAt: 0 });
    },
  );

  it('round-trips a persisted guard', () => {
    const guard = { attempts: 1, windowStartedAt: 1_000, lastAttemptAt: 1_500 };
    expect(parseChunkReloadGuard(JSON.stringify(guard))).toEqual(guard);
  });

  // Written by the build before the burst window existed, and read by the tab
  // that survives the deploy introducing it -- which, given what this file
  // recovers from, is not a hypothetical reader.
  it('reads a guard written before lastAttemptAt existed', () => {
    expect(parseChunkReloadGuard('{"attempts":1,"windowStartedAt":5000}')).toEqual({
      attempts: 1,
      windowStartedAt: 5_000,
      lastAttemptAt: 5_000,
    });
  });
});

describe('decideChunkReload', () => {
  it('reloads on a first error and opens the window', () => {
    expect(decideChunkReload({ attempts: 0, windowStartedAt: 0, lastAttemptAt: 0 }, 5_000)).toEqual({
      action: 'reload',
      guard: { attempts: 1, windowStartedAt: 5_000, lastAttemptAt: 5_000 },
    });
  });

  it('keeps the original window anchor while spending the budget', () => {
    const now = 5_000 + CHUNK_RELOAD_BURST_MS;

    expect(decideChunkReload({ attempts: 1, windowStartedAt: 5_000, lastAttemptAt: 5_000 }, now)).toEqual({
      action: 'reload',
      guard: { attempts: 2, windowStartedAt: 5_000, lastAttemptAt: now },
    });
  });

  it('stops reloading once the budget is spent', () => {
    const guard = { attempts: CHUNK_RELOAD_MAX_ATTEMPTS, windowStartedAt: 5_000, lastAttemptAt: 5_000 };
    const now = 5_000 + CHUNK_RELOAD_BURST_MS;

    expect(decideChunkReload(guard, now)).toEqual({ action: 'exhausted', guard });
  });

  it('allows a fresh attempt once the window has fully elapsed', () => {
    const guard = { attempts: CHUNK_RELOAD_MAX_ATTEMPTS, windowStartedAt: 5_000, lastAttemptAt: 5_000 };
    const now = 5_000 + CHUNK_RELOAD_WINDOW_MS;

    expect(decideChunkReload(guard, now)).toEqual({
      action: 'reload',
      guard: { attempts: 1, windowStartedAt: now, lastAttemptAt: now },
    });
  });

  /**
   * One broken page load, three chunks, all rejecting within a frame -- the exact
   * timings taken from the production issue this window was added for. Charged
   * individually they spend the whole budget in 105ms and file the third as
   * unrecoverable before the reload the first one asked for has happened.
   */
  describe('a burst of rejections from one page load', () => {
    const burst = [0, 3, 105];

    it('spends one attempt and reports nothing', () => {
      let guard = { attempts: 0, windowStartedAt: 0, lastAttemptAt: 0 };
      const actions = burst.map((offset) => {
        const decision = decideChunkReload(guard, 1_000 + offset);
        guard = decision.guard;
        return decision.action;
      });

      expect(actions).toEqual(['reload', 'pending', 'pending']);
      expect(guard.attempts).toBe(1);
    });

    it('leaves the second attempt for the reload that follows', () => {
      // The reloaded document fails too, well after the burst window. That is a
      // real second failure and earns the second attempt.
      const spent = { attempts: 1, windowStartedAt: 1_000, lastAttemptAt: 1_105 };

      expect(decideChunkReload(spent, 4_000).action).toBe('reload');
    });

    /**
     * The tail of a burst that spent the LAST attempt must not report either:
     * the reload it is trailing has not had its chance yet. Checked separately
     * because it is the one case where the burst window has to win over an
     * exhausted budget.
     */
    it('stays quiet when the burst that spent the final attempt is still arriving', () => {
      const spent = {
        attempts: CHUNK_RELOAD_MAX_ATTEMPTS,
        windowStartedAt: 1_000,
        lastAttemptAt: 4_000,
      };

      expect(decideChunkReload(spent, 4_050).action).toBe('pending');
      expect(decideChunkReload(spent, 4_000 + CHUNK_RELOAD_BURST_MS).action).toBe('exhausted');
    });
  });

  it('cannot be kept alive by errors that keep arriving inside the window', () => {
    // The anchor never moves, so a client failing continuously exhausts the budget
    // instead of pushing the deadline out and reloading forever.
    let guard = { attempts: 0, windowStartedAt: 0, lastAttemptAt: 0 };
    let reloads = 0;

    for (let now = 1_000; now < 1_000 + CHUNK_RELOAD_WINDOW_MS; now += CHUNK_RELOAD_BURST_MS * 2) {
      const decision = decideChunkReload(guard, now);
      guard = decision.guard;
      if (decision.action === 'reload') reloads++;
    }

    expect(reloads).toBe(CHUNK_RELOAD_MAX_ATTEMPTS);
  });
});
