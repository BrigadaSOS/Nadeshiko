import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import nodemailer from 'nodemailer';
import { setupTestSuite } from '../helpers/setup';
import { sendEmail, resetTransporterForTests } from '@app/mailers/email';
import * as lifecycleGate from '@app/services/email/lifecycleGate';

setupTestSuite();

let sendMail: ReturnType<typeof vi.fn>;
let createTransport: MockInstance;
let mayReallySend: MockInstance;

beforeEach(() => {
  resetTransporterForTests();
  sendMail = vi.fn().mockResolvedValue({ messageId: 'test' });
  createTransport = vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);
  mayReallySend = vi.spyOn(lifecycleGate, 'mayReallySend').mockReturnValue(false);
});

afterEach(() => {
  createTransport.mockRestore();
  mayReallySend.mockRestore();
  resetTransporterForTests();
});

/**
 * The sweep checks the switch too, and has to — it must not write a claim row
 * for a send it is not making. This is the backstop for every OTHER caller: a
 * bin script, a console session, the recap when it lands. Without it the switch
 * would be a convention rather than a control.
 */
describe('the lifecycle switch, enforced at the send', () => {
  it.each(['feedback-ask', 'dormant-30', 'recap'] as const)('refuses to send %s', async (kind) => {
    await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>hi</p>', kind });

    expect(sendMail).not.toHaveBeenCalled();
  });

  /**
   * Transactional mail is not gated and must never be. A sign-in link that
   * stopped working because somebody had not enabled the newsletter yet would be
   * an outage, not a safety feature.
   */
  it.each(['magic-link', 'verify-new-email', 'welcome', 'feedback'] as const)(
    'still sends %s while the switch is off',
    async (kind) => {
      await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>hi</p>', kind });

      expect(sendMail).toHaveBeenCalledTimes(1);
    },
  );

  it('sends lifecycle mail once the gate allows the recipient', async () => {
    mayReallySend.mockReturnValue(true);

    await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>hi</p>', kind: 'feedback-ask' });

    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  /**
   * Returns rather than throws, like the suppression check beside it. A message
   * we have decided not to send is not a failure, and throwing would burn five
   * pg-boss retries on a job that will never succeed.
   */
  it('does not throw', async () => {
    await expect(
      sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>hi</p>', kind: 'recap' }),
    ).resolves.toBeUndefined();
  });
});
