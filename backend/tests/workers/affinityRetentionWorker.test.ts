import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LessThan } from 'typeorm';
import { UserMediaAffinity } from '@app/models/UserMediaAffinity';
import { registerAffinityRetentionWorker } from '@app/workers/affinityRetentionWorker';
import { AFFINITY_RETENTION_QUEUE } from '@app/workers/queueNames';

/**
 * The affinity tally's 24-month prune.
 *
 * WHAT IS WORTH TESTING HERE is the cutoff arithmetic, and only that. A
 * retention job has no output anyone looks at: it deletes rows on a schedule, in
 * a process nobody is watching, and both ways of getting it wrong are silent.
 * Too far back and it deletes nothing forever, so the table grows without bound;
 * too near and it quietly eats the study history the search filter is ordered
 * by, which surfaces months later as "the ranking got worse" with nothing to
 * point at.
 *
 * `UserMediaAffinity.delete` is mocked rather than exercised against a database:
 * the query is one call and TypeORM is not the thing under test -- the date
 * that goes into it is.
 */

type JobHandler = (jobs: unknown[]) => Promise<void>;

function fakeBoss() {
  const handlers = new Map<string, JobHandler>();
  const work = vi.fn(async (queue: string, handler: JobHandler) => {
    handlers.set(queue, handler);
  });
  return {
    boss: { work } as never,
    work,
    run: (queue: string) => handlers.get(queue)?.([{ id: 'job-1', name: queue, data: {} }]),
  };
}

/** The `periodYyyymm` the delete was told to prune below. */
function cutoffFromDeleteCall(deleteSpy: ReturnType<typeof vi.spyOn>): number {
  const criteria = deleteSpy.mock.calls[0]?.[0] as { periodYyyymm: { value: number } };
  return criteria.periodYyyymm.value;
}

describe('affinityRetentionWorker', () => {
  let deleteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    deleteSpy = vi.spyOn(UserMediaAffinity, 'delete').mockResolvedValue({ affected: 3, raw: [] } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('registers on the affinity retention queue', async () => {
    const { boss, work } = fakeBoss();
    await registerAffinityRetentionWorker(boss);

    expect(work).toHaveBeenCalledWith(AFFINITY_RETENTION_QUEUE, expect.any(Function));
  });

  it('prunes everything older than 24 months, and nothing newer', async () => {
    vi.setSystemTime(new Date('2026-08-14T03:00:00Z'));
    const { boss, run } = fakeBoss();
    await registerAffinityRetentionWorker(boss);
    await run(AFFINITY_RETENTION_QUEUE);

    // August 2026 minus 24 months. `LessThan` and not `LessThanOrEqual`: the
    // cutoff month is the oldest one KEPT, so the window is a full 24 months
    // rather than 23 and a bit.
    expect(deleteSpy).toHaveBeenCalledWith({ periodYyyymm: LessThan(202408) });
    expect(cutoffFromDeleteCall(deleteSpy)).toBe(202408);
  });

  // `yyyymm` is an integer, so every one of these has to come back over a year
  // boundary as 12 months, not as a subtraction of 100 that lands on month 00 or
  // month 13 -- a cutoff of 202500 or 202413 is a number Postgres compares
  // perfectly happily and prunes the wrong rows by.
  it.each([
    ['2026-01-15T00:00:00Z', 202401],
    ['2026-12-31T23:59:59Z', 202412],
    ['2027-02-01T00:00:00Z', 202502],
    // A leap day, and a month-end that the target month does not have.
    ['2028-02-29T12:00:00Z', 202602],
    ['2026-03-31T12:00:00Z', 202403],
  ])('takes the cutoff back exactly two years from %s', async (now, expected) => {
    vi.setSystemTime(new Date(now));
    const { boss, run } = fakeBoss();
    await registerAffinityRetentionWorker(boss);
    await run(AFFINITY_RETENTION_QUEUE);

    const cutoff = cutoffFromDeleteCall(deleteSpy);
    expect(cutoff).toBe(expected);
    // Whatever the arithmetic did, the result has to be a real month.
    expect(cutoff % 100).toBeGreaterThanOrEqual(1);
    expect(cutoff % 100).toBeLessThanOrEqual(12);
  });

  it('lets a failed delete out, so the job is retried rather than counted as done', async () => {
    vi.setSystemTime(new Date('2026-08-14T03:00:00Z'));
    deleteSpy.mockRejectedValueOnce(new Error('connection terminated'));
    const { boss, run } = fakeBoss();
    await registerAffinityRetentionWorker(boss);

    await expect(run(AFFINITY_RETENTION_QUEUE)).rejects.toThrow('connection terminated');
  });
});
