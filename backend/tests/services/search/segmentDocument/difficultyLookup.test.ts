import { afterEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();

vi.mock('@app/models', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@app/models')>();
  return { ...actual, WordFrequency: { query: (...a: unknown[]) => query(...a) } };
});

import { loadDifficultyLookup, resetDifficultyLookup } from '@app/services/search/segmentDocument/difficultyLookup';

const ROWS = [{ rank: 100, word: '猫', form: 'ねこ', isName: false }];
const HOUR = 60 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
  query.mockReset();
  resetDifficultyLookup();
});

describe('loadDifficultyLookup', () => {
  it('loads once and serves the cached list within the hour', async () => {
    query.mockResolvedValue(ROWS);

    const [first, second] = await Promise.all([loadDifficultyLookup(), loadDifficultyLookup()]);
    const third = await loadDifficultyLookup();

    expect(query).toHaveBeenCalledTimes(1);
    expect(first.word.get('猫')).toBe(100);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('keeps the list it has when a reload after the hour fails', async () => {
    vi.useFakeTimers();
    query.mockResolvedValueOnce(ROWS).mockRejectedValueOnce(new Error('connection lost'));

    const loaded = await loadDifficultyLookup();
    vi.advanceTimersByTime(HOUR + 1);
    const reloaded = await loadDifficultyLookup();

    expect(query).toHaveBeenCalledTimes(2);
    expect(reloaded).toBe(loaded);
  });

  it('returns an empty list when the first load fails, so documents are indexed without a difficulty', async () => {
    query.mockRejectedValueOnce(new Error('connection lost'));

    const lookup = await loadDifficultyLookup();

    expect(lookup.word.size).toBe(0);
  });
});
