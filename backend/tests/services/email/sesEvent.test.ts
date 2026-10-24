import { describe, it, expect } from 'vitest';
import { setupTestSuite } from '../../helpers/setup';
import { EmailEvent, EmailSuppression } from '@app/models';
import { recordSesEvent } from '@app/services/email/sesEvent';
import { SOFT_BOUNCE_THRESHOLD } from '@app/services/email/suppression';

setupTestSuite();

/** Shapes follow the SES event-publishing format that SNS carries in `Message`. Timestamps are relative: the
 * seven-day soft-bounce window would make a fixed date fail eventually. */
function bounce(
  overrides: {
    type?: 'Permanent' | 'Transient' | 'Undetermined';
    address?: string;
    tags?: Record<string, string[]>;
  } = {},
) {
  const address = overrides.address ?? 'gone@example.com';
  return {
    eventType: 'Bounce',
    bounce: {
      bounceType: overrides.type ?? 'Permanent',
      bounceSubType: 'General',
      bouncedRecipients: [{ emailAddress: address, diagnosticCode: 'smtp; 550 5.1.1 User unknown' }],
      timestamp: new Date().toISOString(),
    },
    mail: {
      messageId: 'ses-msg-1',
      destination: [address],
      tags: overrides.tags ?? { kind: ['magic-link'] },
      timestamp: new Date().toISOString(),
    },
  };
}

describe('recordSesEvent', () => {
  it('records a permanent bounce as hard and suppresses the address', async () => {
    const events = await recordSesEvent(bounce(), 'sns-1');

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('hard_bounce');
    expect(events[0].address).toBe('gone@example.com');
    expect(events[0].clientReference).toBe('magic-link');
    expect(events[0].emailReference).toBe('ses-msg-1');
    expect(events[0].diagnosticMessage).toBe('smtp; 550 5.1.1 User unknown');
    expect(events[0].reason).toBe('Permanent/General');

    const suppression = await EmailSuppression.findOneBy({ address: 'gone@example.com' });
    expect(suppression?.cause).toBe('hard_bounce');
  });

  it('rebuilds kind:campaign from the two tags', async () => {
    const [event] = await recordSesEvent(
      bounce({ tags: { kind: ['dormant-30'], campaign: ['dormant-30-2026-10'] } }),
      'sns-1',
    );

    expect(event.clientReference).toBe('dormant-30:dormant-30-2026-10');
  });

  it('normalises the address, so a lift and a check agree on one spelling', async () => {
    const [event] = await recordSesEvent(bounce({ address: '  Gone@EXAMPLE.com ' }), 'sns-1');

    expect(event.address).toBe('gone@example.com');
  });

  /** SNS redelivers with the same MessageId; retries must not inflate the bounce rate or suppress twice. */
  it('is a no-op when the same notification arrives twice', async () => {
    await recordSesEvent(bounce(), 'sns-1');
    const second = await recordSesEvent(bounce(), 'sns-1');

    expect(second).toHaveLength(0);
    expect(await EmailEvent.countBy({ address: 'gone@example.com' })).toBe(1);
  });

  it('treats transient and undetermined bounces as soft and suppresses only past the threshold', async () => {
    for (let i = 0; i < SOFT_BOUNCE_THRESHOLD - 1; i++) {
      const [event] = await recordSesEvent(bounce({ type: i % 2 ? 'Undetermined' : 'Transient' }), `sns-${i}`);
      expect(event.event).toBe('soft_bounce');
    }
    expect(await EmailSuppression.findOneBy({ address: 'gone@example.com' })).toBeNull();

    await recordSesEvent(bounce({ type: 'Transient' }), 'sns-last');
    expect((await EmailSuppression.findOneBy({ address: 'gone@example.com' }))?.cause).toBe('repeated_soft_bounce');
  });

  it('suppresses on a complaint', async () => {
    const events = await recordSesEvent(
      {
        eventType: 'Complaint',
        complaint: {
          complainedRecipients: [{ emailAddress: 'annoyed@example.com' }],
          complaintFeedbackType: 'abuse',
          timestamp: new Date().toISOString(),
        },
        mail: { messageId: 'ses-msg-2', destination: ['annoyed@example.com'], tags: { kind: ['dormant-30'] } },
      },
      'sns-2',
    );

    expect(events[0].event).toBe('complaint');
    expect(events[0].reason).toBe('abuse');
    expect((await EmailSuppression.findOneBy({ address: 'annoyed@example.com' }))?.cause).toBe('complaint');
  });

  it('records a reject without suppressing the recipient', async () => {
    const events = await recordSesEvent(
      {
        eventType: 'Reject',
        reject: { reason: 'Bad content' },
        mail: { messageId: 'ses-msg-3', destination: ['reader@example.com'], tags: { kind: ['welcome'] } },
      },
      'sns-3',
    );

    expect(events[0].event).toBe('reject');
    expect(events[0].reason).toBe('Bad content');
    expect(await EmailSuppression.findOneBy({ address: 'reader@example.com' })).toBeNull();
  });
});
