import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestSuite } from '../../helpers/setup';
import { EmailEvent, EmailSuppression } from '@app/models';
import {
  SOFT_BOUNCE_THRESHOLD,
  SOFT_BOUNCE_WINDOW_DAYS,
  countSuppressionsByCause,
  isSuppressed,
  normalizeAddress,
  removeSuppression,
  softBouncedTooOften,
  suppress,
} from '@app/services/email/suppression';

/**
 * The suppression list itself. `suppressionEnforcement.test.ts` covers what
 * REFUSES to send to a suppressed address; this covers how an address gets on
 * and off the list, which is where the two properties that matter live.
 *
 * NORMALISATION is one of them. The unique index is only a real guarantee if
 * every write and every read agree on the shape of an address -- otherwise
 * `Reader@Example.com` is suppressed and `reader@example.com` is not, which is
 * a bounced address we go on mailing.
 *
 * THE FIRST CAUSE WINS is the other, and it is deliberate rather than
 * incidental: a hard bounce followed by a complaint is still an address that
 * does not exist, and overwriting the cause would turn a permanent state into
 * one a future lift treats as recoverable.
 *
 * NOT covered here: `suppress`'s recovery from two webhook deliveries racing on
 * the same address. It works by letting the unique index reject one insert and
 * then re-reading the winner -- and this suite runs every test inside ONE
 * transaction, where a constraint violation aborts the whole thing, so the
 * recovery query cannot run. The path needs two connections to exercise
 * honestly, which this harness does not offer; a test that pretended otherwise
 * would be asserting the harness's failure rather than the code's behaviour.
 */
setupTestSuite();

/** Records an event as the webhook would have, `daysAgo` in the past. */
async function seedEvent(address: string, event: string, daysAgo: number) {
  return EmailEvent.save(
    EmailEvent.create({
      address,
      event,
      // The provider's raw delivery, which the column requires.
      payload: { event, email: address },
      occurredAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
    } as unknown as EmailEvent),
  );
}

const seedSoftBounce = (address: string, daysAgo: number) => seedEvent(address, 'soft_bounce', daysAgo);

beforeEach(async () => {
  await EmailSuppression.query('DELETE FROM "EmailSuppression"');
  await EmailEvent.query('DELETE FROM "EmailEvent"');
});

describe('normalizeAddress', () => {
  it('lowercases, so one address cannot be on the list twice', () => {
    expect(normalizeAddress('Reader@Example.COM')).toBe('reader@example.com');
  });

  it('trims, because a pasted address carries whitespace', () => {
    expect(normalizeAddress('  reader@example.com \n')).toBe('reader@example.com');
  });

  it.each([[''], ['   '], [null], [undefined]])('reads %s as no address at all', (input) => {
    // An empty string as an address would suppress a row that matches every
    // caller who also has no address.
    expect(normalizeAddress(input)).toBeNull();
  });
});

describe('suppress', () => {
  it('puts an address on the list', async () => {
    const row = await suppress({ address: 'gone@example.com', cause: 'hard_bounce' });

    expect(row?.address).toBe('gone@example.com');
    expect(await isSuppressed('gone@example.com')).toBe(true);
  });

  it('stores the address normalised, whatever case it arrived in', async () => {
    // The webhook sends back whatever the recipient typed at signup.
    await suppress({ address: 'Gone@Example.COM', cause: 'hard_bounce' });

    expect(await isSuppressed('gone@example.com')).toBe(true);
  });

  it('keeps the reason the provider gave', async () => {
    const row = await suppress({ address: 'gone@example.com', cause: 'hard_bounce', reason: '550 no such user' });

    expect(row?.reason).toBe('550 no such user');
  });

  it('stores a null reason rather than undefined when none was given', async () => {
    const row = await suppress({ address: 'gone@example.com', cause: 'complaint' });

    expect(row?.reason).toBeNull();
  });

  it('is idempotent -- a repeat delivery does not create a second row', async () => {
    // Webhooks are at-least-once.
    await suppress({ address: 'gone@example.com', cause: 'hard_bounce' });
    await suppress({ address: 'gone@example.com', cause: 'hard_bounce' });

    expect(await EmailSuppression.countBy({ address: 'gone@example.com' })).toBe(1);
  });

  it('does NOT overwrite the cause: the first one is the true one', async () => {
    // A hard bounce followed by a complaint is still an address that does not
    // exist. Rewriting it would make a future lift treat a permanent state as
    // recoverable.
    await suppress({ address: 'gone@example.com', cause: 'hard_bounce' });

    const second = await suppress({ address: 'gone@example.com', cause: 'complaint' });

    expect(second?.cause).toBe('hard_bounce');
    expect((await EmailSuppression.findOneByOrFail({ address: 'gone@example.com' })).cause).toBe('hard_bounce');
  });

  it('returns the standing row, so a caller can report it without a second query', async () => {
    const first = await suppress({ address: 'gone@example.com', cause: 'hard_bounce' });

    const second = await suppress({ address: 'gone@example.com', cause: 'hard_bounce' });

    expect(second?.address).toBe(first?.address);
  });

  it('does nothing at all for an empty address', async () => {
    expect(await suppress({ address: '   ', cause: 'hard_bounce' })).toBeNull();
    expect(await EmailSuppression.count()).toBe(0);
  });
});

describe('isSuppressed', () => {
  it('is false for an address nobody has suppressed', async () => {
    expect(await isSuppressed('fine@example.com')).toBe(false);
  });

  it('matches regardless of the case it is asked about', async () => {
    // The read side of the same guarantee: a lookup that skips normalisation
    // finds nothing and we go on mailing a bounced address.
    await suppress({ address: 'gone@example.com', cause: 'hard_bounce' });

    expect(await isSuppressed('GONE@Example.com')).toBe(true);
    expect(await isSuppressed('  gone@example.com  ')).toBe(true);
  });

  it.each([[''], [null], [undefined]])('is false for %s rather than matching everything', async (input) => {
    await suppress({ address: 'gone@example.com', cause: 'hard_bounce' });

    expect(await isSuppressed(input)).toBe(false);
  });
});

describe('softBouncedTooOften', () => {
  it('counts nothing for an address that has never bounced', async () => {
    expect(await softBouncedTooOften('fine@example.com')).toBe(0);
  });

  it('counts the soft bounces inside the window', async () => {
    for (let i = 0; i < 3; i++) await seedSoftBounce('flaky@example.com', 1);

    expect(await softBouncedTooOften('flaky@example.com')).toBe(3);
  });

  it('ignores bounces older than the window, because it is rolling', async () => {
    // A counter on the address would need resetting on a schedule nobody would
    // remember to run; the event log already holds the answer.
    await seedSoftBounce('flaky@example.com', SOFT_BOUNCE_WINDOW_DAYS + 1);
    await seedSoftBounce('flaky@example.com', 1);

    expect(await softBouncedTooOften('flaky@example.com')).toBe(1);
  });

  it('counts a bounce right at the edge of the window', async () => {
    await seedSoftBounce('flaky@example.com', SOFT_BOUNCE_WINDOW_DAYS - 0.1);

    expect(await softBouncedTooOften('flaky@example.com')).toBe(1);
  });

  it('does not count another address’s bounces', async () => {
    await seedSoftBounce('someone-else@example.com', 1);

    expect(await softBouncedTooOften('flaky@example.com')).toBe(0);
  });

  it('does not count events of another kind', async () => {
    // A delivery and an open are not evidence of anything being wrong.
    await seedEvent('flaky@example.com', 'delivered', 1);

    expect(await softBouncedTooOften('flaky@example.com')).toBe(0);
  });

  it('reaches the threshold only at the threshold', async () => {
    // The number is a judgement -- a genuinely full mailbox clears long before
    // five in a week -- so it is worth pinning that the count crosses where it
    // is meant to.
    for (let i = 0; i < SOFT_BOUNCE_THRESHOLD - 1; i++) await seedSoftBounce('flaky@example.com', 1);
    expect(await softBouncedTooOften('flaky@example.com')).toBeLessThan(SOFT_BOUNCE_THRESHOLD);

    await seedSoftBounce('flaky@example.com', 1);
    expect(await softBouncedTooOften('flaky@example.com')).toBeGreaterThanOrEqual(SOFT_BOUNCE_THRESHOLD);
  });
});

describe('removeSuppression', () => {
  it('takes the address off the list and hands back what was there', async () => {
    // The caller reports the cause that was lifted, which is why the row comes
    // back rather than a boolean.
    await suppress({ address: 'gone@example.com', cause: 'hard_bounce', reason: '550' });

    const removed = await removeSuppression('gone@example.com');

    expect(removed).toMatchObject({ address: 'gone@example.com', cause: 'hard_bounce' });
    expect(await isSuppressed('gone@example.com')).toBe(false);
  });

  it('normalises before deleting, so the operator need not match the case', async () => {
    await suppress({ address: 'gone@example.com', cause: 'hard_bounce' });

    await removeSuppression('  GONE@Example.COM  ');

    expect(await isSuppressed('gone@example.com')).toBe(false);
  });

  it('reports nothing removed for an address that was not on the list', async () => {
    // The operator's CLI says so rather than claiming a lift it did not make.
    expect(await removeSuppression('never@example.com')).toBeNull();
  });

  it('reports nothing removed for an empty address', async () => {
    await suppress({ address: 'gone@example.com', cause: 'hard_bounce' });

    expect(await removeSuppression('  ')).toBeNull();
    expect(await isSuppressed('gone@example.com')).toBe(true);
  });

  it('leaves other addresses alone', async () => {
    await suppress({ address: 'a@example.com', cause: 'hard_bounce' });
    await suppress({ address: 'b@example.com', cause: 'complaint' });

    await removeSuppression('a@example.com');

    expect(await isSuppressed('b@example.com')).toBe(true);
  });
});

describe('countSuppressionsByCause', () => {
  it('reports a zero for every cause, not an absent key', async () => {
    // The gauge reads this. A missing series and a series at zero look very
    // different on a graph, and only one of them is true.
    const counts = await countSuppressionsByCause();

    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    expect(Object.keys(counts).length).toBeGreaterThan(1);
  });

  it('counts each cause separately', async () => {
    await suppress({ address: 'a@example.com', cause: 'hard_bounce' });
    await suppress({ address: 'b@example.com', cause: 'hard_bounce' });
    await suppress({ address: 'c@example.com', cause: 'complaint' });

    const counts = await countSuppressionsByCause();

    expect(counts.hard_bounce).toBe(2);
    expect(counts.complaint).toBe(1);
  });

  it('returns numbers, not the strings the driver gives for a COUNT', async () => {
    // `COUNT(*)` comes back as a string from pg; a gauge fed a string records
    // nothing and says nothing about why.
    await suppress({ address: 'a@example.com', cause: 'hard_bounce' });

    expect(typeof (await countSuppressionsByCause()).hard_bounce).toBe('number');
  });
});
