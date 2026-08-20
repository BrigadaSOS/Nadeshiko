import { describe, it, expect } from 'vitest';
import { MAGIC_LINK_HOLD_BACKS, holdBackFor } from './magicLinkHoldBack';

describe('holdBackFor', () => {
  it('lengthens the wait with each send', () => {
    expect(holdBackFor(1)).toBe(30);
    expect(holdBackFor(2)).toBe(60);
    expect(holdBackFor(3)).toBe(120);
  });

  /**
   * The last entry repeats rather than the list running off its end. Without
   * this a fourth send reads `undefined`, and a countdown from `NaN` never
   * finishes — the resend button would simply never come back.
   */
  it('repeats the last entry forever', () => {
    expect(holdBackFor(4)).toBe(120);
    expect(holdBackFor(99)).toBe(120);
  });

  /** A count of zero must not index backwards off the front of the list. */
  it.each([0, -1])('clamps a count of %i to the first wait', (count) => {
    expect(holdBackFor(count)).toBe(MAGIC_LINK_HOLD_BACKS[0]);
  });

  /**
   * The schedule has to fit inside the five-an-hour budget it exists to pace:
   * five sends spread over minutes, not seconds.
   */
  it('spreads five sends across several minutes', () => {
    const total = [1, 2, 3, 4, 5].reduce((sum, send) => sum + holdBackFor(send), 0);

    expect(total).toBeGreaterThan(5 * 60);
  });
});
