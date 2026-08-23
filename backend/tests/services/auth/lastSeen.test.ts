import { describe, it, expect } from 'vitest';
import { shouldRecordLastSeen, resolveUserId } from '@app/services/auth/lastSeen';

describe('resolveUserId', () => {
  /** better-auth hands ids back as numbers or numeric strings depending on path. */
  it('accepts both shapes better-auth uses', () => {
    expect(resolveUserId({ userId: 7 })).toBe(7);
    expect(resolveUserId({ userId: '7' })).toBe(7);
  });

  it('rejects anything that is not a positive integer id', () => {
    for (const userId of [0, -1, 1.5, '', 'abc', null, undefined, {}]) {
      expect(resolveUserId({ userId })).toBeNull();
    }
    expect(resolveUserId(null)).toBeNull();
  });
});

describe('shouldRecordLastSeen', () => {
  it('records an ordinary session', () => {
    expect(shouldRecordLastSeen({ userId: 7 })).toBe(true);
  });

  /**
   * The rule this predicate exists for. An admin acting as another account is
   * not that account being used, and letting it through would corrupt the one
   * thing these columns are for.
   */
  it('never records an impersonated session', () => {
    expect(shouldRecordLastSeen({ userId: 7, impersonatedBy: 1 })).toBe(false);
    expect(shouldRecordLastSeen({ userId: 7, impersonatedBy: '1' })).toBe(false);
  });

  it('ignores a session with no usable user id', () => {
    expect(shouldRecordLastSeen({})).toBe(false);
    expect(shouldRecordLastSeen(null)).toBe(false);
    expect(shouldRecordLastSeen(undefined)).toBe(false);
  });
});
