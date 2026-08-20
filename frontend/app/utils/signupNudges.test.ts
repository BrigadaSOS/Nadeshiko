import { describe, expect, it } from 'vitest';
import type { IntentStorage } from '~/utils/authAnalytics';
import {
  DEPTH_PLAYS_THRESHOLD,
  DEPTH_SEARCHES_THRESHOLD,
  NUDGE_COOLDOWN_MS,
  depthReached,
  isNudgeDue,
  nudgeStorageKey,
  recordNudgeShown,
} from '~/utils/signupNudges';

const NOW = 1_770_000_000_000;

function fakeStorage(initial: Record<string, string> = {}): IntentStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

/** Storage that refuses every operation, as Safari private mode does. */
const hostileStorage: IntentStorage = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
  removeItem: () => {
    throw new Error('denied');
  },
};

describe('isNudgeDue', () => {
  it('is due when the nudge has never been shown', () => {
    expect(isNudgeDue(fakeStorage(), 'download', NOW)).toBe(true);
  });

  it('is not due immediately after being shown', () => {
    const storage = fakeStorage();
    recordNudgeShown(storage, 'download', NOW);

    expect(isNudgeDue(storage, 'download', NOW)).toBe(false);
  });

  it('is not due one millisecond before the cooldown elapses', () => {
    const storage = fakeStorage();
    recordNudgeShown(storage, 'download', NOW);

    expect(isNudgeDue(storage, 'download', NOW + NUDGE_COOLDOWN_MS - 1)).toBe(false);
  });

  it('is due again once the cooldown has elapsed', () => {
    const storage = fakeStorage();
    recordNudgeShown(storage, 'download', NOW);

    expect(isNudgeDue(storage, 'download', NOW + NUDGE_COOLDOWN_MS)).toBe(true);
  });

  it('keeps each nudge on its own cooldown', () => {
    const storage = fakeStorage();
    recordNudgeShown(storage, 'download', NOW);

    expect(isNudgeDue(storage, 'depth', NOW)).toBe(true);
  });

  // The failure that matters: a key we cannot read must not silence an ask
  // forever. One extra toast is recoverable, a reader we never ask again is not.
  it('is due when the stored value is unparseable', () => {
    const storage = fakeStorage({ [nudgeStorageKey('download')]: 'not-a-number' });

    expect(isNudgeDue(storage, 'download', NOW)).toBe(true);
  });

  it('is due when the stored value is in the future, as clock skew leaves it', () => {
    const storage = fakeStorage({ [nudgeStorageKey('download')]: String(NOW + 60_000) });

    expect(isNudgeDue(storage, 'download', NOW)).toBe(true);
  });

  it('is due when storage is absent or refuses to be read', () => {
    expect(isNudgeDue(undefined, 'download', NOW)).toBe(true);
    expect(isNudgeDue(hostileStorage, 'download', NOW)).toBe(true);
  });

  it('does not throw when storage refuses to be written', () => {
    expect(() => recordNudgeShown(hostileStorage, 'download', NOW)).not.toThrow();
    expect(() => recordNudgeShown(undefined, 'download', NOW)).not.toThrow();
  });
});

describe('depthReached', () => {
  it('is not reached by a reader who is still sampling', () => {
    expect(depthReached({ plays: DEPTH_PLAYS_THRESHOLD - 1, searches: DEPTH_SEARCHES_THRESHOLD - 1 })).toBe(false);
  });

  it('is reached on plays alone', () => {
    expect(depthReached({ plays: DEPTH_PLAYS_THRESHOLD, searches: 0 })).toBe(true);
  });

  it('is reached on searches alone', () => {
    expect(depthReached({ plays: 0, searches: DEPTH_SEARCHES_THRESHOLD })).toBe(true);
  });

  // The thresholds describe two different readers -- one studying a single
  // search, one hunting across several -- so requiring both would ask only the
  // intersection, which is the smallest group rather than the most convinced.
  it('does not require both thresholds together', () => {
    expect(depthReached({ plays: DEPTH_PLAYS_THRESHOLD, searches: 0 })).toBe(true);
    expect(depthReached({ plays: 0, searches: DEPTH_SEARCHES_THRESHOLD })).toBe(true);
  });
});
