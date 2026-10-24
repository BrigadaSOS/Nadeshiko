import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import nodemailer from 'nodemailer';
import { setupTestSuite } from '../../helpers/setup';
import { EmailSuppression, User } from '@app/models';
import { sendEmail, sendMagicLinkEmail, resetTransporterForTests } from '@app/mailers/email';
import { suppress } from '@app/services/email/suppression';
import { recordSesEvent } from '@app/services/email/sesEvent';

setupTestSuite();

let sendMail: ReturnType<typeof vi.fn>;
let createTransport: MockInstance;

beforeEach(() => {
  resetTransporterForTests();
  sendMail = vi.fn().mockResolvedValue({ messageId: 'test' });
  createTransport = vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);
});

afterEach(() => {
  createTransport.mockRestore();
  resetTransporterForTests();
});

describe('the suppression check in sendEmail', () => {
  it('sends to an address that is not suppressed', async () => {
    await sendEmail({ to: 'fine@example.com', subject: 'Hi', html: '<p>hi</p>', kind: 'welcome' });

    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('does not send to a suppressed address', async () => {
    await suppress({ address: 'gone@example.com', cause: 'hard_bounce' });

    await sendEmail({ to: 'gone@example.com', subject: 'Hi', html: '<p>hi</p>', kind: 'welcome' });

    expect(sendMail).not.toHaveBeenCalled();
  });

  /** Return rather than throw for a policy rejection; a known-bad welcome address must not consume pg-boss retries. */
  it('returns quietly rather than throwing, so a queued job does not fail', async () => {
    await suppress({ address: 'gone@example.com', cause: 'hard_bounce' });

    await expect(
      sendEmail({ to: 'gone@example.com', subject: 'Hi', html: '<p>hi</p>', kind: 'welcome' }),
    ).resolves.toBeUndefined();
  });

  it('matches a suppressed address regardless of the case it is written in', async () => {
    await suppress({ address: 'gone@example.com', cause: 'hard_bounce' });

    await sendEmail({ to: 'GONE@Example.COM', subject: 'Hi', html: '<p>hi</p>', kind: 'welcome' });

    expect(sendMail).not.toHaveBeenCalled();
  });

  /** Check suppression in `sendEmail`, not each sender, so every send path shares the enforcement point. */
  it('stops any sender, not just the ones that remember to ask', async () => {
    await suppress({ address: 'gone@example.com', cause: 'complaint' });

    await sendMagicLinkEmail('gone@example.com', 'https://nadeshiko.co/verify?token=x');

    expect(sendMail).not.toHaveBeenCalled();
  });

  it('tags the message with X-Nadeshiko-Client-Ref so a bounce can name the mail that caused it', async () => {
    await sendEmail({ to: 'fine@example.com', subject: 'Hi', html: '<p>hi</p>', kind: 'magic-link' });

    expect(sendMail.mock.calls[0][0].headers).toEqual({ 'X-Nadeshiko-Client-Ref': 'magic-link' });
  });
});

describe('a hard bounce and the account behind it', () => {
  it('clears is_verified so the UI can ask for a working address', async () => {
    const user = await User.save(
      User.create({
        username: `bouncer-${Date.now()}`,
        email: 'bouncer@example.com',
        isVerified: true,
        isActive: true,
      }),
    );

    await recordSesEvent(
      {
        eventType: 'Bounce',
        mail: { destination: ['bouncer@example.com'] },
        bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'bouncer@example.com' }] },
      },
      'sns-verified',
    );

    const reloaded = await User.findOneByOrFail({ id: user.id });
    expect(reloaded.isVerified).toBe(false);
    expect(await EmailSuppression.findOneBy({ address: 'bouncer@example.com' })).not.toBeNull();
  });
});
