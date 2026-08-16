import { describe, it, expect } from 'vitest';
import { hashUserId } from '@lib/userLogHash';

describe('hashUserId', () => {
  it('is stable for one account, so log lines can be joined on it', () => {
    expect(hashUserId(328, 'salt-a')).toBe(hashUserId(328, 'salt-a'));
  });

  it('separates accounts', () => {
    expect(hashUserId(328, 'salt-a')).not.toBe(hashUserId(329, 'salt-a'));
  });

  /**
   * The property the field exists for, and the reason the salt is not optional
   * in spirit. User ids are small consecutive integers: an unsalted digest is a
   * lookup table anyone can build in under a second, so the field would be a
   * plaintext id with extra steps. Rotating the salt is also the documented way
   * to invalidate every prior join, which only works if the output moves.
   */
  it('moves with the salt', () => {
    expect(hashUserId(328, 'salt-a')).not.toBe(hashUserId(328, 'salt-b'));
  });

  // The cache is keyed on the id alone, so a rotation that did not clear it
  // would keep serving pre-rotation digests -- a join key that silently spans
  // both sides of the rotation it was meant to end.
  it('does not serve a pre-rotation digest after the salt changes', () => {
    const before = hashUserId(328, 'salt-a');
    hashUserId(328, 'salt-b');
    expect(hashUserId(328, 'salt-a')).toBe(before);
    expect(hashUserId(328, 'salt-b')).not.toBe(before);
  });

  // Absent rather than unsalted: a bare digest would look like protection while
  // providing none, which is worse than an empty field.
  it('produces nothing at all when no salt is configured', () => {
    expect(hashUserId(328, undefined)).toBeUndefined();
    expect(hashUserId(328, '')).toBeUndefined();
  });

  it('is short enough to read and long enough not to collide', () => {
    expect(hashUserId(328, 'salt-a')).toMatch(/^[0-9a-f]{16}$/);
  });
});
