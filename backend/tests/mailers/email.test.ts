import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import * as emailQueueModule from '@app/workers/emailQueue';
import { sendWelcomeEmail, sendAnnouncementEmail } from '@app/mailers/email';

let sendEmailJobSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sendEmailJobSpy = vi.spyOn(emailQueueModule, 'sendEmailJob').mockResolvedValue('mock-job-id');
});

afterEach(() => {
  sendEmailJobSpy.mockRestore();
});

describe('sendWelcomeEmail', () => {
  it('enqueues an email job with the correct dedupe key', async () => {
    await sendWelcomeEmail(42, 'testuser', 'test@example.com');

    expect(sendEmailJobSpy).toHaveBeenCalledTimes(1);

    const [emailData, dedupeKey] = sendEmailJobSpy.mock.calls[0];
    expect(dedupeKey).toBe('welcome-42');
    expect(emailData.to).toBe('test@example.com');
    expect(emailData.subject).toBe('Welcome to Nadeshiko!');
  });

  it('produces the same dedupe key on repeated calls for the same user', async () => {
    await sendWelcomeEmail(7, 'alice', 'alice@example.com');
    await sendWelcomeEmail(7, 'alice', 'alice@example.com');

    const keys = sendEmailJobSpy.mock.calls.map((call: unknown[]) => call[1]);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toBe('welcome-7');
  });

  it('produces different dedupe keys for different users', async () => {
    await sendWelcomeEmail(1, 'alice', 'alice@example.com');
    await sendWelcomeEmail(2, 'bob', 'bob@example.com');

    const keys = sendEmailJobSpy.mock.calls.map((call: unknown[]) => call[1]);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('includes html with the username', async () => {
    await sendWelcomeEmail(1, 'testuser', 'test@example.com');

    const [emailData] = sendEmailJobSpy.mock.calls[0];
    expect(emailData.html).toContain('testuser');
    expect(emailData.html).toContain('<');
  });
});

describe('sendAnnouncementEmail', () => {
  it('enqueues an email job with a subject-based dedupe key', async () => {
    await sendAnnouncementEmail(10, 'bob', 'bob@example.com', 'New Terms', 'Please review.');

    expect(sendEmailJobSpy).toHaveBeenCalledTimes(1);

    const [emailData, dedupeKey] = sendEmailJobSpy.mock.calls[0];
    expect(dedupeKey).toBe('announcement-10-new-terms');
    expect(emailData.to).toBe('bob@example.com');
    expect(emailData.subject).toBe('New Terms');
  });

  it('normalizes whitespace in the dedupe key', async () => {
    await sendAnnouncementEmail(5, 'user', 'u@test.com', 'API  SDK   Changes', 'Details here.');

    const [, dedupeKey] = sendEmailJobSpy.mock.calls[0];
    expect(dedupeKey).toBe('announcement-5-api-sdk-changes');
  });

  it('produces the same dedupe key for the same user and subject', async () => {
    await sendAnnouncementEmail(3, 'alice', 'a@test.com', 'Update', 'msg1');
    await sendAnnouncementEmail(3, 'alice', 'a@test.com', 'Update', 'msg2');

    const keys = sendEmailJobSpy.mock.calls.map((call: unknown[]) => call[1]);
    expect(keys[0]).toBe(keys[1]);
  });

  it('produces different dedupe keys for different subjects', async () => {
    await sendAnnouncementEmail(3, 'alice', 'a@test.com', 'Terms Update', 'msg');
    await sendAnnouncementEmail(3, 'alice', 'a@test.com', 'SDK Update', 'msg');

    const keys = sendEmailJobSpy.mock.calls.map((call: unknown[]) => call[1]);
    expect(keys[0]).not.toBe(keys[1]);
  });
});
