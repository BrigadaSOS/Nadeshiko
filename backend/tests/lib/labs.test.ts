import { describe, it, expect } from 'bun:test';
import type { User } from '@app/models/User';
import type { LabEnrollment } from '@app/models/LabEnrollment';
import { isLabActive } from '@lib/labs';

function makeUser(id = 1, enrollments: Pick<LabEnrollment, 'labKey'>[] = []): User {
  return { id, labEnrollments: enrollments } as User;
}

describe('isLabActive', () => {
  it('returns false when the lab key does not exist', () => {
    expect(isLabActive(makeUser(), 'missing')).toBe(false);
  });

  it('returns false for an existing lab when the user is not enrolled', () => {
    expect(isLabActive(makeUser(), 'interactive-tokens')).toBe(false);
  });

  it('returns true for an existing lab when the user is enrolled', () => {
    expect(isLabActive(makeUser(1, [{ labKey: 'interactive-tokens' }]), 'interactive-tokens')).toBe(true);
  });
});
