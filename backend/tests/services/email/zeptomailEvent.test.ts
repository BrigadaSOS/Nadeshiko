import { describe, it, expect } from 'vitest';
import { setupTestSuite } from '../../helpers/setup';
import { EmailEvent, EmailSuppression } from '@app/models';
import { recordZeptomailPayload } from '@app/services/email/zeptomailEvent';
import { SOFT_BOUNCE_THRESHOLD } from '@app/services/email/suppression';

setupTestSuite();

/** Use ZeptoMail's documented array-wrapped payload and the accepted unwrapped form; no complete sample is
 * published, so both shapes are part of the parser contract. */
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
      // Use a relative timestamp, never a literal: the seven-day suppression window would eventually make a fixed-date
      // fixture fail without a code change.
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

  /** Redeliveries must be idempotent; otherwise webhook retries inflate the bounce rate used by alerts. */
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

  /** Verify posts sample payloads, not a ping; sample feedback-loop data must not trigger a production complaint
   * alert when the webhook is configured. */
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

  /** Record an unknown event name rather than dropping it; losing an event is worse than retaining one that cannot
   * yet be acted on. */
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

  /** A full mailbox is not proof of abuse; five bounces within a week is the threshold. */
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

  /** The first cause is authoritative: replacing a hard-bounce cause with a complaint would make a permanent state
   * look recoverable to a future lift. */
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

  /** A missing provider timestamp means now rather than rejection; timestamps have been absent from payloads before
   * the format was documented. */
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
