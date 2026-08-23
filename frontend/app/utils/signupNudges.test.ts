import { describe, expect, it } from 'vitest';
import type { IntentStorage } from '~/utils/authAnalytics';
import {
  DEPTH_PLAYS_THRESHOLD,
  DEPTH_SEARCHES_THRESHOLD,
  NUDGE_ASK_LIMIT,
  NUDGE_BY_TRIGGER,
  NUDGE_COOLDOWN_MS,
  NUDGE_LATE_COOLDOWN_MS,
  NUDGE_QUIET_KEY,
  NUDGE_QUIET_MS,
  NUDGE_TRIGGERS,
  SIGNUP_NUDGES,
  depthReached,
  isNudgeDue,
  nudgeStorageKey,
  readNudgeRecord,
  recordNudgeDismissed,
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

  it('keeps each nudge on its own cooldown once the quiet period is over', () => {
    const storage = fakeStorage();
    recordNudgeShown(storage, 'download', NOW);

    const afterQuiet = NOW + NUDGE_QUIET_MS;
    expect(isNudgeDue(storage, 'depth', afterQuiet)).toBe(true);
    expect(isNudgeDue(storage, 'download', afterQuiet)).toBe(false);
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
    expect(() => recordNudgeDismissed(hostileStorage, 'download')).not.toThrow();
    expect(() => recordNudgeDismissed(undefined, 'download')).not.toThrow();
  });
});

// The reader who plays five clips and then opens the add menu meets two
// different panels a minute apart, and neither auto-dismisses, so the second
// stacks on the first.
describe('the quiet period between different panels', () => {
  it('holds the other panel back for two days', () => {
    const storage = fakeStorage();
    recordNudgeShown(storage, 'depth', NOW);

    expect(isNudgeDue(storage, 'download', NOW + 60_000)).toBe(false);
    expect(isNudgeDue(storage, 'download', NOW + NUDGE_QUIET_MS - 1)).toBe(false);
  });

  it('releases it afterwards', () => {
    const storage = fakeStorage();
    recordNudgeShown(storage, 'depth', NOW);

    expect(isNudgeDue(storage, 'download', NOW + NUDGE_QUIET_MS)).toBe(true);
  });

  // Same tolerance as everywhere else here: a key we cannot read must not be
  // able to silence every panel at once.
  it('is ignored when its key is unparseable or future-dated', () => {
    expect(isNudgeDue(fakeStorage({ [NUDGE_QUIET_KEY]: 'nonsense' }), 'depth', NOW)).toBe(true);
    expect(isNudgeDue(fakeStorage({ [NUDGE_QUIET_KEY]: String(NOW + 60_000) }), 'depth', NOW)).toBe(true);
  });
});

describe('the cooldown ladder', () => {
  /** Shows the panel as many times as the ladder allows, and reports when each ask landed. */
  function climb(storage: IntentStorage, nudge: 'download' | 'depth' = 'download'): number[] {
    const shownAt: number[] = [];
    let now = NOW;

    // Far more attempts than the cap, so a ladder that never ends fails here
    // rather than looping forever.
    for (let attempt = 0; attempt < 12; attempt++) {
      if (isNudgeDue(storage, nudge, now)) {
        recordNudgeShown(storage, nudge, now);
        shownAt.push(now);
      }
      now += NUDGE_LATE_COOLDOWN_MS;
    }

    return shownAt;
  }

  it('asks a second time a week later, not a day later', () => {
    const storage = fakeStorage();
    recordNudgeShown(storage, 'download', NOW);

    expect(isNudgeDue(storage, 'download', NOW + NUDGE_COOLDOWN_MS - 1)).toBe(false);
    expect(isNudgeDue(storage, 'download', NOW + NUDGE_COOLDOWN_MS)).toBe(true);
  });

  it('makes the third ask wait a month rather than another week', () => {
    const storage = fakeStorage();
    recordNudgeShown(storage, 'download', NOW);
    const second = NOW + NUDGE_COOLDOWN_MS;
    recordNudgeShown(storage, 'download', second);

    expect(isNudgeDue(storage, 'download', second + NUDGE_COOLDOWN_MS)).toBe(false);
    expect(isNudgeDue(storage, 'download', second + NUDGE_LATE_COOLDOWN_MS)).toBe(true);
  });

  it('stops for good after three asks', () => {
    const storage = fakeStorage();

    expect(climb(storage)).toHaveLength(NUDGE_ASK_LIMIT);
  });

  it('numbers each ask, so a repeat can be told from a first sighting', () => {
    const storage = fakeStorage();

    expect(recordNudgeShown(storage, 'download', NOW)).toBe(1);
    expect(recordNudgeShown(storage, 'download', NOW + NUDGE_COOLDOWN_MS)).toBe(2);
  });

  // A reader who pressed "Not now" has answered; one who left the panel sitting
  // there may never have seen it. Only the first is worth cutting short.
  it('spends two asks on a dismissal, so a dismisser is asked twice not three times', () => {
    const storage = fakeStorage();
    recordNudgeShown(storage, 'download', NOW);
    recordNudgeDismissed(storage, 'download');

    // Two spent already, so the next wait is the long one.
    expect(isNudgeDue(storage, 'download', NOW + NUDGE_COOLDOWN_MS)).toBe(false);
    expect(isNudgeDue(storage, 'download', NOW + NUDGE_LATE_COOLDOWN_MS)).toBe(true);

    const second = NOW + NUDGE_LATE_COOLDOWN_MS;
    recordNudgeShown(storage, 'download', second);
    recordNudgeDismissed(storage, 'download');

    expect(isNudgeDue(storage, 'download', second + NUDGE_LATE_COOLDOWN_MS * 12)).toBe(false);
  });

  it('does not count a dismissal as a fresh interruption', () => {
    const storage = fakeStorage();
    recordNudgeShown(storage, 'download', NOW);
    recordNudgeDismissed(storage, 'download');

    expect(readNudgeRecord(storage, 'download')?.at).toBe(NOW);
  });

  it('ignores a dismissal it has no record of showing', () => {
    const storage = fakeStorage();
    recordNudgeDismissed(storage, 'download');

    expect(isNudgeDue(storage, 'download', NOW)).toBe(true);
  });
});

describe('readNudgeRecord', () => {
  // Written by every version of this module before the ladder existed. Readers
  // carrying one have been asked once, and should resume rather than restart.
  it('reads a bare timestamp as a single ask already spent', () => {
    const storage = fakeStorage({ [nudgeStorageKey('download')]: String(NOW) });

    expect(readNudgeRecord(storage, 'download')).toEqual({ at: NOW, shows: 1, dismissals: 0 });
    expect(isNudgeDue(storage, 'download', NOW + NUDGE_COOLDOWN_MS - 1)).toBe(false);
    expect(isNudgeDue(storage, 'download', NOW + NUDGE_COOLDOWN_MS)).toBe(true);
  });

  it('round-trips what recordNudgeShown wrote', () => {
    const storage = fakeStorage();
    recordNudgeShown(storage, 'depth', NOW);

    expect(readNudgeRecord(storage, 'depth')).toEqual({ at: NOW, shows: 1, dismissals: 0 });
  });

  it('returns nothing for state it cannot make sense of', () => {
    expect(readNudgeRecord(fakeStorage(), 'download')).toBeNull();
    expect(readNudgeRecord(fakeStorage({ [nudgeStorageKey('download')]: '{"shows":2}' }), 'download')).toBeNull();
    expect(readNudgeRecord(hostileStorage, 'download')).toBeNull();
  });

  it('falls back to sane counters when only they are corrupt', () => {
    const storage = fakeStorage({
      [nudgeStorageKey('download')]: JSON.stringify({ at: NOW, shows: 'two', dismissals: -1 }),
    });

    expect(readNudgeRecord(storage, 'download')).toEqual({ at: NOW, shows: 1, dismissals: 0 });
  });
});

describe('NUDGE_BY_TRIGGER', () => {
  it('raises one panel for both ways a reader reaches for Anki', () => {
    expect(NUDGE_BY_TRIGGER.download).toBe('download');
    expect(NUDGE_BY_TRIGGER.add_menu).toBe('download');
  });

  // The whole reason the two triggers share a nudge: saving a clip and then
  // opening the add menu is one reader in one sitting, and the second panel
  // would repeat the first word for word.
  it('spends a single cooldown across those two triggers', () => {
    const storage = fakeStorage();
    recordNudgeShown(storage, NUDGE_BY_TRIGGER.download, NOW);

    // Past the cross-panel quiet period, so this is the shared cooldown talking
    // rather than the blanket one.
    expect(isNudgeDue(storage, NUDGE_BY_TRIGGER.add_menu, NOW + NUDGE_QUIET_MS)).toBe(false);
  });

  it('maps every trigger to a real nudge', () => {
    for (const trigger of NUDGE_TRIGGERS) {
      expect(SIGNUP_NUDGES).toContain(NUDGE_BY_TRIGGER[trigger]);
    }
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
