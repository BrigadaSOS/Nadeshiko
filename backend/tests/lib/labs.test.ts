import { describe, it, expect } from 'bun:test';
import type { User } from '@app/models/User';
import { isLabActive } from '@lib/labs';

describe('isLabActive', () => {
  it('returns false when the lab key does not exist', () => {
    const user = { id: 1, labEnrollments: [] } as unknown as User;
    expect(isLabActive(user, 'missing')).toBe(false);
  });
});
