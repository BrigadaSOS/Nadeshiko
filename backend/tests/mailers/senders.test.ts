import { describe, it, expect } from 'vitest';
import { SENDERS, fromNameFor, senderForUser } from '@app/mailers/senders';

describe('who writes to a reader', () => {
  /** Sender selection is sticky, not random: a person should receive coherent follow-up mail and reply to the author
   * they saw. */
  it('always picks the same person for the same reader', () => {
    for (const userId of [1, 2, 42, 644, 1_000_003]) {
      expect(senderForUser(userId)).toBe(senderForUser(userId));
    }
  });

  it('has Natsume sign for every reader', () => {
    const keys = Array.from({ length: 100 }, (_, i) => senderForUser(i + 1).key);

    expect(keys.every((key) => key === 'natsume')).toBe(true);
  });

  /** A real mailbox on the sending domain, or replies bounce. */
  it('gives every sender an address on the domain', () => {
    for (const sender of SENDERS) expect(sender.email).toMatch(/@nadeshiko\.co$/);
  });

  it('signs with their own name rather than the product', () => {
    expect(fromNameFor(SENDERS[0])).toBe('Natsume from Nadeshiko');
  });
});
