import { describe, it, expect } from 'vitest';
import { encryptSecret } from '@lib/secretBox';
import { config } from '@config/config';
import { issueUnsubscribeToken, readUnsubscribeToken, acceptsProductEmails } from '@app/services/email/unsubscribe';

describe('unsubscribe tokens', () => {
  it('round-trips the account it was issued for', () => {
    expect(readUnsubscribeToken(issueUnsubscribeToken(42))).toEqual({ userId: 42 });
  });

  it('issues a different string each time, since the nonce is random', () => {
    expect(issueUnsubscribeToken(42)).not.toBe(issueUnsubscribeToken(42));
  });

  /**
   * The token travels in a query string, so anything a mail client might do to
   * it -- percent-encoding, line-wrapping a long URL -- has to survive or be
   * refused, never silently resolve to somebody else.
   */
  it('is URL-safe, so no client has to encode it', () => {
    const token = issueUnsubscribeToken(7);
    expect(encodeURIComponent(token)).toBe(token);
  });

  it('refuses a token sealed for another purpose', () => {
    const foreign = encryptSecret(JSON.stringify({ userId: 42 }), config.BETTER_AUTH_SECRET, {
      purpose: 'feedback.form-token',
    });
    expect(readUnsubscribeToken(foreign)).toBeNull();
  });

  /**
   * The point of sealing rather than signing: an attacker who edits the account
   * id gets a payload that no longer authenticates, not one naming a stranger.
   */
  it('refuses a tampered token', () => {
    const token = issueUnsubscribeToken(42);
    const parts = token.split('.');
    const flipped = Buffer.from(parts[4], 'base64url');
    flipped[0] ^= 0xff;
    parts[4] = flipped.toString('base64url');

    expect(readUnsubscribeToken(parts.join('.'))).toBeNull();
  });

  it('refuses a token sealed under a different secret', () => {
    const foreign = encryptSecret(JSON.stringify({ userId: 42 }), 'a-completely-different-root-secret', {
      purpose: 'email.unsubscribe',
    });
    expect(readUnsubscribeToken(foreign)).toBeNull();
  });

  it.each(['', 'not-a-token', 'v2.abc.def', '../../etc/passwd'])('refuses junk: %s', (junk) => {
    expect(readUnsubscribeToken(junk)).toBeNull();
  });

  it('refuses a well-sealed token whose payload names no account', () => {
    const empty = encryptSecret(JSON.stringify({}), config.BETTER_AUTH_SECRET, { purpose: 'email.unsubscribe' });
    expect(readUnsubscribeToken(empty)).toBeNull();
  });
});

describe('acceptsProductEmails', () => {
  /**
   * Absent means yes. Every account that existed before this preference did has
   * no key at all, and reading that as "opted out" would silently mean nobody
   * ever receives the lifecycle mail.
   */
  it('defaults to yes for preferences that predate the flag', () => {
    expect(acceptsProductEmails({})).toBe(true);
    expect(acceptsProductEmails(null)).toBe(true);
    expect(acceptsProductEmails(undefined)).toBe(true);
  });

  it('honours an explicit opt-out', () => {
    expect(acceptsProductEmails({ productEmails: { enabled: false } })).toBe(false);
  });

  it('honours an explicit opt-in', () => {
    expect(acceptsProductEmails({ productEmails: { enabled: true } })).toBe(true);
  });
});

describe('the finer grain', () => {
  it('sends a category the reader has said nothing about', () => {
    expect(acceptsProductEmails({ productEmails: { enabled: true } }, 'recap')).toBe(true);
    expect(acceptsProductEmails({}, 'recap')).toBe(true);
  });

  it('stops a category the reader turned off', () => {
    expect(acceptsProductEmails({ productEmails: { enabled: true, recap: false } }, 'recap')).toBe(false);
  });

  it('leaves the other categories alone', () => {
    const preferences = { productEmails: { enabled: true, recap: false } };

    expect(acceptsProductEmails(preferences, 'checkins')).toBe(true);
    expect(acceptsProductEmails(preferences, 'updates')).toBe(true);
  });

  /**
   * THE MIGRATION HAZARD. A reader who turned everything off before a category
   * existed has no opinion stored about it, and reading that silence as consent
   * would re-subscribe every opt-out the day a new category ships.
   */
  it('never reads a missing category as a fresh yes', () => {
    const goneAway = { productEmails: { enabled: false } };

    expect(acceptsProductEmails(goneAway, 'recap')).toBe(false);
    expect(acceptsProductEmails(goneAway, 'checkins')).toBe(false);
    expect(acceptsProductEmails(goneAway)).toBe(false);
  });

  /** The master still answers the broad question, which the audience export asks. */
  it('answers the categoryless question from the master alone', () => {
    expect(acceptsProductEmails({ productEmails: { enabled: true, recap: false } })).toBe(true);
  });
});

/**
 * RFC 8058 unsubscribes the reader from "the list" that sent the message, and a
 * category is that list. One-clicking out of a monthly recap says nothing about
 * the one question we ask at day seven.
 */
describe('what a one-click unsubscribe speaks for', () => {
  it('carries the category the message belonged to', () => {
    expect(readUnsubscribeToken(issueUnsubscribeToken(42, 'recap'))).toEqual({ userId: 42, category: 'recap' });
  });

  /** What a token minted before categories existed meant, and the safe reading. */
  it('means everything when it names no category', () => {
    expect(readUnsubscribeToken(issueUnsubscribeToken(42))?.category).toBeUndefined();
  });

  /**
   * A category we do not recognise can only come from a version of this that
   * knew something we do not, and "everything" is the safe reading of a list we
   * cannot name.
   */
  it('drops a category it cannot place rather than trusting it', () => {
    const forged = issueUnsubscribeToken(42);
    const withUnknown = readUnsubscribeToken(forged);

    expect(withUnknown).toEqual({ userId: 42 });
    expect(acceptsProductEmails({ productEmails: { enabled: true } }, 'recap')).toBe(true);
  });
});
