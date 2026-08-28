import { describe, it, expect } from 'vitest';
import { setupTestSuite } from '../../helpers/setup';
import { EmailEvent, EmailSuppression } from '@app/models';
import { recordZeptomailPayload } from '@app/services/email/zeptomailEvent';
import { SOFT_BOUNCE_THRESHOLD } from '@app/services/email/suppression';

setupTestSuite();

/**
 * A payload in the shape ZeptoMail actually posts: several fields wrapped in a
 * single-element array. The published documentation carries no complete sample,
 * so the parser accepts both this and the unwrapped form, and both are tested.
 */
function bouncePayload(overrides: { event?: string; address?: string; requestId?: string; wrap?: boolean } = {}) {
  const event = overrides.event ?? 'hardbounce';
  const address = overrides.address ?? 'gone@example.com';
  const wrap = overrides.wrap ?? true;

  const message = {
    request_id: 'msg-1',
    email_info: {
      to: [{ email_address: { address } }],
      client_reference: 'magic-link',
      email_reference: 'ref-1',
      // RELATIVE, NEVER A LITERAL. This becomes `EmailEvent.occurredAt`, and the
      // soft-bounce threshold only counts bounces inside a seven-day window --
      // so a fixed date makes the suppression tests pass until the wall clock
      // walks past it, then fail forever with no code change. That is exactly
      // what happened to '2026-08-20T10:00:00Z'.
      processed_time: new Date().toISOString(),
    },
    event_data: wrap
      ? [{ details: [{ bounced_recipient: address, reason: '550', diagnostic_message: 'User unknown' }] }]
      : { details: [{ bounced_recipient: address, reason: '550', diagnostic_message: 'User unknown' }] },
  };

  return {
    event_name: wrap ? [event] : event,
    webhook_request_id: overrides.requestId ?? 'wh-1',
    event_message: wrap ? [message] : message,
  };
}

describe('recordZeptomailPayload', () => {
  it('records a hard bounce and suppresses the address', async () => {
    const events = await recordZeptomailPayload(bouncePayload());

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('hard_bounce');
    expect(events[0].address).toBe('gone@example.com');
    expect(events[0].clientReference).toBe('magic-link');
    expect(events[0].diagnosticMessage).toBe('User unknown');

    const suppression = await EmailSuppression.findOneBy({ address: 'gone@example.com' });
    expect(suppression?.cause).toBe('hard_bounce');
  });

  it('reads the unwrapped payload shape too', async () => {
    const events = await recordZeptomailPayload(bouncePayload({ wrap: false }));

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('hard_bounce');
  });

  it('normalises the address, so a lift and a check agree on one spelling', async () => {
    const events = await recordZeptomailPayload(bouncePayload({ address: '  Gone@EXAMPLE.com ' }));

    expect(events[0].address).toBe('gone@example.com');
  });

  /**
   * The idempotency contract. ZeptoMail's retry behaviour is undocumented, and a
   * redelivery that counted twice would inflate the bounce rate the alert rules
   * divide -- on a webhook retry rather than on a bounce.
   */
  it('is a no-op when the same delivery arrives twice', async () => {
    await recordZeptomailPayload(bouncePayload());
    const second = await recordZeptomailPayload(bouncePayload());

    expect(second).toHaveLength(0);
    expect(await EmailEvent.countBy({ address: 'gone@example.com' })).toBe(1);
  });

  it('records a different delivery for the same address', async () => {
    await recordZeptomailPayload(bouncePayload({ requestId: 'wh-1' }));
    const second = await recordZeptomailPayload(bouncePayload({ requestId: 'wh-2' }));

    expect(second).toHaveLength(1);
    expect(await EmailEvent.countBy({ address: 'gone@example.com' })).toBe(2);
  });

  /**
   * ZeptoMail's Verify button POSTs SAMPLE PAYLOADS at the URL, not a ping, and
   * they look exactly like real events. A sample feedback-loop payload would
   * otherwise fire a critical complaint tripwire on the day the webhook is
   * configured, and teach everyone the channel cries wolf.
   */
  it('ignores the zylker.com samples a Verify probe sends', async () => {
    const events = await recordZeptomailPayload(bouncePayload({ event: 'feedback', address: 'rebecca@zylker.com' }));

    expect(events).toHaveLength(0);
    expect(await EmailEvent.count()).toBe(0);
    expect(await EmailSuppression.count()).toBe(0);
  });

  it('still records a real recipient that arrives alongside a sample one', async () => {
    const payload = bouncePayload({ address: 'real@example.com' });
    const message = (payload.event_message as Record<string, unknown>[])[0];
    (message.event_data as Record<string, unknown>[])[0] = {
      details: [
        { bounced_recipient: 'sample@zylker.com', reason: '550' },
        { bounced_recipient: 'real@example.com', reason: '550' },
      ],
    };

    const events = await recordZeptomailPayload(payload);

    expect(events).toHaveLength(1);
    expect(events[0].address).toBe('real@example.com');
  });

  /**
   * Losing an event we did not anticipate is worse than holding one we cannot
   * act on, so an unmapped name is recorded under its own name rather than
   * dropped.
   */
  it('records an unrecognised event name under its own name', async () => {
    const events = await recordZeptomailPayload(bouncePayload({ event: 'something_new' }));

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('something_new');
    expect(await EmailSuppression.count()).toBe(0);
  });

  it('maps every documented spelling of a complaint onto one name', async () => {
    for (const [index, name] of ['feedback', 'feedback_loop', 'feedbackloop', 'complaint'].entries()) {
      const events = await recordZeptomailPayload(
        bouncePayload({ event: name, address: `c${index}@example.com`, requestId: `wh-c${index}` }),
      );
      expect(events[0].event).toBe('complaint');
    }
  });

  it('suppresses a complaint permanently', async () => {
    await recordZeptomailPayload(bouncePayload({ event: 'feedback', address: 'angry@example.com' }));

    const suppression = await EmailSuppression.findOneBy({ address: 'angry@example.com' });
    expect(suppression?.cause).toBe('complaint');
  });

  it('records an open without suppressing anything', async () => {
    const events = await recordZeptomailPayload(bouncePayload({ event: 'emailopen', address: 'reader@example.com' }));

    expect(events[0].event).toBe('open');
    expect(await EmailSuppression.count()).toBe(0);
  });

  /**
   * A full mailbox is not a verdict. Five inside a week is: a genuinely full
   * mailbox clears long before that.
   */
  it('suppresses a soft bounce only on the fifth in a week, not the fourth', async () => {
    for (let i = 1; i < SOFT_BOUNCE_THRESHOLD; i += 1) {
      await recordZeptomailPayload(
        bouncePayload({ event: 'softbounce', address: 'full@example.com', requestId: `wh-s${i}` }),
      );
    }
    expect(await EmailSuppression.count()).toBe(0);

    await recordZeptomailPayload(
      bouncePayload({ event: 'softbounce', address: 'full@example.com', requestId: 'wh-s5' }),
    );

    const suppression = await EmailSuppression.findOneBy({ address: 'full@example.com' });
    expect(suppression?.cause).toBe('repeated_soft_bounce');
  });

  /**
   * The FIRST cause is the true one. A hard bounce followed by a complaint is
   * still an address that does not exist, and rewriting the cause would turn a
   * permanent complaint into something a future lift treats as recoverable.
   */
  it('keeps the first cause when a second event would suppress again', async () => {
    await recordZeptomailPayload(bouncePayload({ address: 'both@example.com', requestId: 'wh-a' }));
    await recordZeptomailPayload(bouncePayload({ event: 'feedback', address: 'both@example.com', requestId: 'wh-b' }));

    const rows = await EmailSuppression.findBy({ address: 'both@example.com' });
    expect(rows).toHaveLength(1);
    expect(rows[0].cause).toBe('hard_bounce');
  });

  it('stores the payload whole, which is what tells us whether the parsing guessed right', async () => {
    const payload = bouncePayload();
    const events = await recordZeptomailPayload(payload);

    expect(events[0].payload).toEqual(payload);
  });

  it('falls back to the to list when no per-recipient detail is present', async () => {
    const events = await recordZeptomailPayload({
      event_name: ['emailopen'],
      webhook_request_id: 'wh-open',
      event_message: [{ email_info: { to: [{ email_address: { address: 'reader@example.com' } }] } }],
    });

    expect(events).toHaveLength(1);
    expect(events[0].address).toBe('reader@example.com');
  });

  it('records nothing, and does not throw, for a payload with no recipient at all', async () => {
    const events = await recordZeptomailPayload({ event_name: ['emailopen'], event_message: [{}] });

    expect(events).toHaveLength(0);
  });

  /**
   * ZeptoMail's own timestamps have gone missing from a payload before being
   * documented, so a missing one is "now" rather than a validation failure on an
   * event we already believe.
   */
  it('defaults a missing timestamp to now rather than rejecting the event', async () => {
    const before = Date.now();
    const events = await recordZeptomailPayload({
      event_name: ['hardbounce'],
      webhook_request_id: 'wh-nots',
      event_message: [
        {
          email_info: { to: [{ email_address: { address: 'nots@example.com' } }] },
          event_data: [{ details: [{ bounced_recipient: 'nots@example.com' }] }],
        },
      ],
    });

    expect(events[0].occurredAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });
});
