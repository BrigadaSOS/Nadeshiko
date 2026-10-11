import { expect } from 'vitest';
import { TestDataSource } from './setup';

let _savepointCounter = 0;

/** Run `block` inside a savepoint so a caught PostgreSQL error (such as an FK violation) does not leave the
 * surrounding transaction aborted. */
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

/** Assert a count delta after `block`; `delta` may be zero or negative, and nested calls can check multiple
 * counters. */
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

/** Assert that a count is unchanged after `block`, mirroring Rails' `assert_no_difference`. */
export async function assertNoDifference(counter: () => Promise<number>, block: () => Promise<void>): Promise<void> {
  return assertDifference(counter, 0, block);
}

/** Assert a value transition after `block`, mirroring Rails' `assert_changes`. `from` is optional when only the
 * final value matters. */
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
