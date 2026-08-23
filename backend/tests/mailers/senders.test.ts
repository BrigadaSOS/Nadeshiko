import { describe, it, expect } from 'vitest';
import { SENDERS, fromNameFor, senderForUser } from '@app/mailers/senders';

describe('who writes to a reader', () => {
  /**
   * STICKY, NOT RANDOM. A coin flip per message gives the same split across the
   * audience and an incoherent experience for each person in it: a welcome from
   * one of them, a question from the other a week later, and a reply that
   * reaches somebody who did not write the last one.
   */
  it('always picks the same person for the same reader', () => {
    for (const userId of [1, 2, 42, 644, 1_000_003]) {
      expect(senderForUser(userId)).toBe(senderForUser(userId));
    }
  });

  it('splits sequential accounts evenly between them', () => {
    const keys = Array.from({ length: 100 }, (_, i) => senderForUser(i + 1).key);

    expect(keys.filter((key) => key === 'dav')).toHaveLength(50);
    expect(keys.filter((key) => key === 'natsume')).toHaveLength(50);
  });

  /** Both are real mailboxes on the sending domain, or replies bounce. */
  it('gives each of them their own address on the domain', () => {
    const addresses = SENDERS.map((sender) => sender.email);

    expect(new Set(addresses).size).toBe(2);
    for (const address of addresses) expect(address).toMatch(/@nadeshiko\.co$/);
  });

  it('signs with their own name rather than the product', () => {
    expect(fromNameFor(SENDERS[0])).toBe('Dav from Nadeshiko');
    expect(fromNameFor(SENDERS[1])).toBe('Natsume from Nadeshiko');
  });
});
