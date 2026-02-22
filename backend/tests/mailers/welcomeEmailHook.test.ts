import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { auth } from '@config/auth';
import * as emailModule from '@app/mailers/email';
import * as emailQueueModule from '@app/workers/emailQueue';
import { deleteAuthUserByEmail } from '../helpers/authUsers';

let sendWelcomeEmailSpy: ReturnType<typeof vi.fn>;
let sendEmailJobSpy: ReturnType<typeof vi.fn>;

// better-auth uses its own pg.Pool, not TypeORM's QueryRunner,
// so transaction rollback won't cover these rows. Each test email is
// cleaned before and after so tests are isolated and self-healing.
const TEST_EMAILS = [
  'hooktest@nadeshiko.test',
  'hookfail@nadeshiko.test',
  'dedupetest@nadeshiko.test',
  'verified@nadeshiko.test',
];

beforeEach(async () => {
  await Promise.all(TEST_EMAILS.map(deleteAuthUserByEmail));
  sendWelcomeEmailSpy = vi.spyOn(emailModule, 'sendWelcomeEmail').mockResolvedValue();
  sendEmailJobSpy = vi.spyOn(emailQueueModule, 'sendEmailJob').mockResolvedValue('mock-job-id');
});

afterEach(async () => {
  sendWelcomeEmailSpy.mockRestore();
  sendEmailJobSpy.mockRestore();
  await Promise.all(TEST_EMAILS.map(deleteAuthUserByEmail));
});

describe('better-auth user creation hook', () => {
  it('enqueues a welcome email when a new user is created', async () => {
    const ctx = await auth.$context;

    const user = await ctx.internalAdapter.createUser({
      name: 'hooktest',
      email: 'hooktest@nadeshiko.test',
    });

    expect(sendEmailJobSpy).toHaveBeenCalledTimes(1);
    const [emailData, dedupeKey] = sendEmailJobSpy.mock.calls[0];
    expect(dedupeKey).toBe(`welcome-${user.id}`);
    expect(emailData.to).toBe('hooktest@nadeshiko.test');
    expect(emailData.subject).toBe('Welcome to Nadeshiko!');
  });

  it('does not fail user creation if the email job fails', async () => {
    sendEmailJobSpy.mockRejectedValueOnce(new Error('queue down'));

    const ctx = await auth.$context;

    const user = await ctx.internalAdapter.createUser({
      name: 'hookfail',
      email: 'hookfail@nadeshiko.test',
    });

    expect(user.id).toBeDefined();
    expect(user.email).toBe('hookfail@nadeshiko.test');
  });

  it('passes a stable dedupe key to sendEmailJob to prevent duplicate emails', async () => {
    sendWelcomeEmailSpy.mockRestore();
    sendWelcomeEmailSpy = null as any;

    const ctx = await auth.$context;

    const user = await ctx.internalAdapter.createUser({
      name: 'dedupetest',
      email: 'dedupetest@nadeshiko.test',
    });

    expect(sendEmailJobSpy).toHaveBeenCalledTimes(1);
    const [emailData, dedupeKey] = sendEmailJobSpy.mock.calls[0];
    expect(dedupeKey).toBe(`welcome-${user.id}`);
    expect(emailData.to).toBe('dedupetest@nadeshiko.test');
    expect(emailData.subject).toBe('Welcome to Nadeshiko!');

    // Re-create the spy so afterEach can restore it
    sendWelcomeEmailSpy = vi.spyOn(emailModule, 'sendWelcomeEmail').mockResolvedValue();
  });

  it('sets emailVerified to true via the before hook', async () => {
    const ctx = await auth.$context;

    const user = await ctx.internalAdapter.createUser({
      name: 'verifiedtest',
      email: 'verified@nadeshiko.test',
    });

    expect(user.emailVerified).toBe(true);
  });
});
