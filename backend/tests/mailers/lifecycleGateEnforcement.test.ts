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

/** Enforce the gate in `sendEmail` too, so scripts cannot bypass it; the sweep checks it before claiming a send. */
describe('the lifecycle switch, enforced at the send', () => {
  it.each(['feedback-ask', 'dormant-30', 'recap'] as const)('refuses to send %s', async (kind) => {
    await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>hi</p>', kind });

    expect(sendMail).not.toHaveBeenCalled();
  });

  /** Transactional mail is intentionally ungated: disabling newsletters must not break sign-in links. */
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

  /** Return normally for a suppressed send, like the adjacent suppression check; throwing would spend pg-boss
   * retries on a deliberate no-op. */
  it('does not throw', async () => {
    await expect(
      sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>hi</p>', kind: 'recap' }),
    ).resolves.toBeUndefined();
  });
});
