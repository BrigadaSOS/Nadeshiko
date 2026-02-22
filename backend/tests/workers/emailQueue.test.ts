import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { sendEmailJob } from '@app/workers/emailQueue';
import { setBossInstance } from '@app/workers/pgBossClient';
import { EMAIL_SEND_QUEUE } from '@app/workers/queueNames';

describe('emailQueue', () => {
  let sendDebounced: ReturnType<typeof vi.fn>;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendDebounced = vi.fn().mockResolvedValue('deduped-job-id');
    send = vi.fn().mockResolvedValue('job-id');

    setBossInstance({
      sendDebounced,
      send,
    } as any);
  });

  it('uses sendDebounced when dedupe key is provided', async () => {
    const jobId = await sendEmailJob(
      {
        to: 'user@example.com',
        subject: 'Hello',
        html: '<p>hello</p>',
      },
      'welcome-42',
    );

    expect(jobId).toBe('deduped-job-id');
    expect(sendDebounced).toHaveBeenCalledTimes(1);
    expect(sendDebounced).toHaveBeenCalledWith(
      EMAIL_SEND_QUEUE,
      {
        to: 'user@example.com',
        subject: 'Hello',
        html: '<p>hello</p>',
      },
      null,
      0,
      'welcome-42',
    );
  });

  it('uses send when no dedupe key is provided', async () => {
    const jobId = await sendEmailJob({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });

    expect(jobId).toBe('job-id');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(EMAIL_SEND_QUEUE, {
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });
  });
});
