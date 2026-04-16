import { expect } from 'bun:test';
import { TestDataSource } from './setup';

let _savepointCounter = 0;

/**
 * Run `block` inside a savepoint so that if a DB operation inside the block
 * aborts the PostgreSQL transaction (e.g. FK violation caught by the error
 * handler), we can automatically recover the transaction back to a valid state.
 */
async function withSavepointRecovery(block: () => Promise<void>): Promise<void> {
  // During a test, createQueryRunner() returns the current test's runner
  const runner = TestDataSource.createQueryRunner();

  const sp = `sp_assert_${++_savepointCounter}`;
  await runner.query(`SAVEPOINT "${sp}"`);
  await block();

  try {
    await runner.query('SELECT 1');
    await runner.query(`RELEASE SAVEPOINT "${sp}"`);
  } catch {
    await runner.query(`ROLLBACK TO SAVEPOINT "${sp}"`);
  }
}

/**
 * Assert that a count changes by the expected delta after executing the block.
 * Mirrors Rails' assert_difference.
 *
 * @example
 * await assertDifference(() => Episode.count(), +1, async () => {
 *   await request(app).post(`/v1/media/${media.id}/episodes`).send({ episodeNumber: 1 });
 * });
 *
 * // Multiple counters — call in parallel before the block, check after:
 * await assertDifference(() => Media.count(), +1, async () => {
 *   await assertDifference(() => Episode.count(), 0, async () => {
 *     await request(app).post('/v1/media').send(buildCreateMediaBody());
 *   });
 * });
 */
export async function assertDifference(
  counter: () => Promise<number>,
  delta: number,
  block: () => Promise<void>,
): Promise<void> {
  const before = await counter();
  await withSavepointRecovery(block);
  const after = await counter();
  expect(after - before, `Expected count to change by ${delta > 0 ? '+' : ''}${delta}`).toBe(delta);
}

/**
 * Assert that a count does not change after executing the block.
 * Mirrors Rails' assert_no_difference.
 *
 * @example
 * await assertNoDifference(() => Episode.count(), async () => {
 *   await request(app).post('/v1/media/999/episodes').send({ episodeNumber: 1 });
 * });
 */
export async function assertNoDifference(counter: () => Promise<number>, block: () => Promise<void>): Promise<void> {
  return assertDifference(counter, 0, block);
}

/**
 * Assert that a value changes from one value to another after executing the block.
 * Mirrors Rails' assert_changes. `from` is optional — omit it to only check the final state.
 *
 * @example
 * await assertChanges(
 *   async () => (await Episode.findOneByOrFail({ id: pilot.id })).titleEn,
 *   { from: 'Pilot', to: 'New Title' },
 *   async () => {
 *     await request(app).patch(`/v1/media/${media.id}/episodes/1`).send({ titleEn: 'New Title' });
 *   },
 * );
 */
export async function assertChanges<T>(
  getter: () => Promise<T>,
  options: { from?: Awaited<T>; to: Awaited<T> },
  block: () => Promise<void>,
): Promise<void> {
  const before = (await getter()) as Awaited<T>;
  if (options.from !== undefined) {
    expect(before, 'assertChanges: initial value did not match `from`').toEqual(options.from as Awaited<T>);
  }
  await block();
  const after = (await getter()) as Awaited<T>;
  expect(after, 'assertChanges: value did not change to expected `to`').toEqual(options.to);
}
