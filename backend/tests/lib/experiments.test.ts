import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { Experiment } from '@app/models/Experiment';
import type { User } from '@app/models/User';
import type { ExperimentEnrollment } from '@app/models/ExperimentEnrollment';
import { invalidateExperimentCache, isExperimentActive } from '@lib/experiments';

function makeExp(overrides: Partial<Experiment> = {}): Experiment {
  return Object.assign(Object.create(Experiment.prototype), {
    id: 1,
    key: 'exp',
    enabled: true,
    enforced: false,
    rolloutPercentage: 0,
    allowedUserIds: [],
    ...overrides,
  });
}

function makeUser(id = 1, enrollments: Pick<ExperimentEnrollment, 'experimentKey'>[] = []): User {
  return { id, experimentEnrollments: enrollments } as User;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let findSpy: any;

beforeEach(() => {
  invalidateExperimentCache();
});

afterEach(() => {
  findSpy?.mockRestore();
  findSpy = undefined;
  invalidateExperimentCache();
});

describe('getExperimentMap cache behaviour', () => {
  it('returns cached map on subsequent calls within TTL (line 14)', async () => {
    findSpy = spyOn(Experiment, 'find').mockResolvedValue([makeExp()]);

    await isExperimentActive(makeUser(), 'exp');
    await isExperimentActive(makeUser(), 'exp');

    expect(findSpy).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent calls — only one DB query fires (line 17)', async () => {
    let resolveFind!: (experiments: Experiment[]) => void;
    const deferred = new Promise<Experiment[]>((r) => { resolveFind = r; });

    findSpy = spyOn(Experiment, 'find').mockReturnValue(deferred as any);

    const p1 = isExperimentActive(makeUser(), 'exp');
    const p2 = isExperimentActive(makeUser(), 'exp');

    resolveFind([]);
    await Promise.all([p1, p2]);

    expect(findSpy).toHaveBeenCalledTimes(1);
  });

  it('discards superseded load when invalidated mid-flight, then re-fetches (lines 28, 30-31)', async () => {
    let resolveFirst!: (experiments: Experiment[]) => void;
    const firstLoad = new Promise<Experiment[]>((r) => { resolveFirst = r; });

    findSpy = spyOn(Experiment, 'find')
      .mockReturnValueOnce(firstLoad as any)
      .mockResolvedValueOnce([makeExp()]);

    const p = isExperimentActive(makeUser(), 'exp');

    // Invalidate while the first load is still in flight
    invalidateExperimentCache();

    // Resolve the now-superseded first load
    resolveFirst([]);
    await p;

    // Should have fired a second fetch after detecting the generation mismatch
    expect(findSpy).toHaveBeenCalledTimes(2);
  });

  it('resets loading sentinel after error so the next call can retry (lines 33-35)', async () => {
    findSpy = spyOn(Experiment, 'find')
      .mockRejectedValueOnce(new Error('DB down'))
      .mockResolvedValueOnce([]);

    await expect(isExperimentActive(makeUser(), 'exp')).rejects.toThrow('DB down');

    // Sentinel should be cleared — the next call must not receive the rejected promise
    const result = await isExperimentActive(makeUser(), 'exp');
    expect(result).toBe(false);
    expect(findSpy).toHaveBeenCalledTimes(2);
  });
});

describe('isExperimentActive', () => {
  it('returns false when the experiment key does not exist', async () => {
    findSpy = spyOn(Experiment, 'find').mockResolvedValue([]);
    expect(await isExperimentActive(makeUser(), 'missing')).toBe(false);
  });

  it('returns false when the experiment is disabled', async () => {
    findSpy = spyOn(Experiment, 'find').mockResolvedValue([makeExp({ enabled: false })]);
    expect(await isExperimentActive(makeUser(), 'exp')).toBe(false);
  });

  it('returns true for an enforced experiment when the user is in allowedUserIds', async () => {
    findSpy = spyOn(Experiment, 'find').mockResolvedValue([makeExp({ enforced: true, allowedUserIds: [1] })]);
    expect(await isExperimentActive(makeUser(1), 'exp')).toBe(true);
  });

  it('returns false for an enforced experiment when the user is not eligible', async () => {
    findSpy = spyOn(Experiment, 'find').mockResolvedValue([
      makeExp({ enforced: true, rolloutPercentage: 0, allowedUserIds: [] }),
    ]);
    expect(await isExperimentActive(makeUser(1), 'exp')).toBe(false);
  });

  it('returns false for an opt-in experiment when the user is not enrolled', async () => {
    findSpy = spyOn(Experiment, 'find').mockResolvedValue([makeExp({ enforced: false, rolloutPercentage: 100 })]);
    expect(await isExperimentActive(makeUser(1, []), 'exp')).toBe(false);
  });

  it('returns true for an opt-in experiment when the user is enrolled', async () => {
    findSpy = spyOn(Experiment, 'find').mockResolvedValue([makeExp({ enforced: false, rolloutPercentage: 100 })]);
    expect(await isExperimentActive(makeUser(1, [{ experimentKey: 'exp' }]), 'exp')).toBe(true);
  });
});
