import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { setupTestSuite } from '../helpers/setup';
import * as emailQueueModule from '@app/workers/emailQueue';
import * as lifecycleGate from '@app/services/email/lifecycleGate';
import { EmailLifecycleSend, EmailSuppression, User, UserActivity } from '@app/models';
import { ActivityType } from '@app/models/UserActivity';
import { runLifecycleSweep } from '@app/workers/emailLifecycleWorker';
import type { EmailJobData } from '@app/workers/emailQueue';
import type { DeepPartial } from 'typeorm';

setupTestSuite();

let enqueued: EmailJobData[];
let sendEmailJob: MockInstance;

beforeEach(() => {
  enqueued = [];
  sendEmailJob = vi.spyOn(emailQueueModule, 'sendEmailJob').mockImplementation(async (data) => {
    enqueued.push(data);
    return 'mock-job-id';
  });
});

afterEach(() => {
  sendEmailJob.mockRestore();
});

let seq = 0;

/**
 * `created_at` is a `CreateDateColumn`, so TypeORM stamps it on insert and the
 * age these tests turn on has to be written afterwards.
 */
async function userAgedDays(days: number, overrides: DeepPartial<User> = {}): Promise<User> {
  seq += 1;
  // Overrides applied after `create` rather than spread inside it: a
  // `DeepPartial` in the literal widens the argument enough that TypeORM's
  // array overload wins, and `save` then answers `User[]`.
  const user = User.create({
    username: `sweep-${seq}`,
    email: `sweep-${seq}@example.com`,
    isActive: true,
    preferences: {},
  });
  Object.assign(user, overrides);
  await user.save();

  await User.query(`UPDATE "User" SET created_at = now() - make_interval(days => $1, hours => 12) WHERE id = $2`, [
    days,
    user.id,
  ]);

  return user;
}

const kindsSent = () => enqueued.map((job) => job.kind);

describe('the day-7 onboarding sweep', () => {
  it('mails an account that registered seven days ago', async () => {
    const user = await userAgedDays(7);

    await runLifecycleSweep();

    expect(kindsSent()).toEqual(['onboarding-day7']);
    expect(enqueued[0]?.to).toBe(user.email);
  });

  /**
   * A range, not "older than seven days". If the sweep misses a few nights, the
   * backlog must not all go out at once: a day-7 email arriving on day 40 is not
   * a day-7 email, and to a relay the batch looks like exactly the thing it is
   * not.
   */
  it.each([0, 3, 6, 9, 40])('leaves an account aged %i days alone', async (age) => {
    await userAgedDays(age);

    await runLifecycleSweep();

    expect(kindsSent()).not.toContain('onboarding-day7');
  });

  it('sends once even when the sweep runs twice the same night', async () => {
    await userAgedDays(7);

    await runLifecycleSweep();
    await runLifecycleSweep();

    expect(kindsSent()).toEqual(['onboarding-day7']);
  });

  it('records what it sent, so a later sweep can see it', async () => {
    const user = await userAgedDays(7);

    await runLifecycleSweep();

    const rows = await EmailLifecycleSend.findBy({ userId: user.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('onboarding-day7');
  });

  it('respects an opt-out', async () => {
    await userAgedDays(7, { preferences: { productEmails: { enabled: false } } });

    await runLifecycleSweep();

    expect(enqueued).toHaveLength(0);
  });

  it('skips a deactivated account', async () => {
    await userAgedDays(7, { isActive: false });

    await runLifecycleSweep();

    expect(enqueued).toHaveLength(0);
  });

  /**
   * `sendEmail` would refuse the send anyway, but by then the claim row is
   * written and the account has spent its one chance at this email on a message
   * nobody could have received.
   */
  it('does not burn the one-shot on a suppressed address', async () => {
    const user = await userAgedDays(7);
    await EmailSuppression.save(
      EmailSuppression.create({ address: user.email.toLowerCase(), cause: 'hard_bounce', suppressedAt: new Date() }),
    );

    await runLifecycleSweep();

    expect(enqueued).toHaveLength(0);
    expect(await EmailLifecycleSend.countBy({ userId: user.id })).toBe(0);
  });
});

describe('which day-7 variant a reader gets', () => {
  const variantFrom = (html: string) => {
    const match = html.match(/utm_campaign=onboarding-day7-([a-z-]+)/);
    return match?.[1];
  };

  it('leads with getting started when they have never searched', async () => {
    await userAgedDays(7);

    await runLifecycleSweep();

    expect(variantFrom(enqueued[0]?.html ?? '')).toBe('getting-started');
  });

  it('leads with Anki when they have searched but never exported', async () => {
    const user = await userAgedDays(7);
    await UserActivity.save(UserActivity.create({ userId: user.id, activityType: ActivityType.SEARCH }));

    await runLifecycleSweep();

    expect(variantFrom(enqueued[0]?.html ?? '')).toBe('anki');
  });

  it('moves past the basics once they have done both', async () => {
    const user = await userAgedDays(7);
    await UserActivity.save([
      UserActivity.create({ userId: user.id, activityType: ActivityType.SEARCH }),
      UserActivity.create({ userId: user.id, activityType: ActivityType.ANKI_EXPORT }),
    ]);

    await runLifecycleSweep();

    expect(variantFrom(enqueued[0]?.html ?? '')).toBe('going-further');
  });

  /**
   * THE TRAP THIS WHOLE BRANCH EXISTS FOR. `UserActivity` is written only for
   * readers who leave `searchHistory` on, so for anyone who turned it off the
   * counts are zero for a reason that has nothing to do with whether they use
   * the site. Reading that as "never searched" would send the absolute
   * beginner's email to somebody mining daily — and the reason we cannot tell is
   * that they asked us not to keep the log.
   */
  it('infers nothing when the reader turned their activity log off', async () => {
    await userAgedDays(7, { preferences: { searchHistory: { enabled: false } } });

    await runLifecycleSweep();

    expect(variantFrom(enqueued[0]?.html ?? '')).toBe('going-further');
  });

  /**
   * The two halves of "has never exported", which used to be one email.
   *
   * A reader with no profile has not started; a reader WITH one has started,
   * finished, and been refused by AnkiConnect on their own machine. Of the 263
   * accounts created in the 90 days to 2026-08-20, 102 were in the second group
   * against 107 who had exported — so the variant telling them to go and set up
   * Anki export was addressing the larger half by describing what they had
   * already done.
   */
  it('tells a reader with no profile how to set Anki up', async () => {
    const user = await userAgedDays(7);
    await UserActivity.save(UserActivity.create({ userId: user.id, activityType: ActivityType.SEARCH }));

    await runLifecycleSweep();

    expect(variantFrom(enqueued[0]?.html ?? '')).toBe('anki');
  });

  it('tells a reader who saved a profile and never exported why it fails', async () => {
    const user = await userAgedDays(7, {
      preferences: {
        ankiProfiles: [{ id: 'p1', name: 'Default', fields: [], serverAddress: 'http://127.0.0.1:8765' }],
      },
    });
    await UserActivity.save(UserActivity.create({ userId: user.id, activityType: ActivityType.SEARCH }));

    await runLifecycleSweep();

    expect(variantFrom(enqueued[0]?.html ?? '')).toBe('anki-stalled');
  });

  /**
   * The one signal that survives the activity log being off, because it is a
   * preference rather than a logged action. A saved profile with no visible
   * usage is still worth one nudge about the connection: that step fails
   * silently, so "we cannot see them exporting" and "they cannot export" look
   * identical from here, and only one of them is fixable by an email.
   */
  it('still reaches a stalled reader whose activity log is off', async () => {
    await userAgedDays(7, {
      preferences: {
        searchHistory: { enabled: false },
        ankiProfiles: [{ id: 'p1', name: 'Default', fields: [], serverAddress: 'http://127.0.0.1:8765' }],
      },
    });

    await runLifecycleSweep();

    expect(variantFrom(enqueued[0]?.html ?? '')).toBe('anki-stalled');
  });
});

describe('the day-30 feedback ask', () => {
  it('mails an account that registered thirty days ago', async () => {
    await userAgedDays(30);

    await runLifecycleSweep();

    expect(kindsSent()).toEqual(['feedback-ask']);
  });

  it('is a different one-shot from the day-7 note', async () => {
    const user = await userAgedDays(30);
    await EmailLifecycleSend.save(
      EmailLifecycleSend.create({
        userId: user.id,
        kind: 'onboarding-day7',
        campaign: 'onboarding-day7',
        sentAt: new Date(),
      }),
    );

    await runLifecycleSweep();

    expect(kindsSent()).toEqual(['feedback-ask']);
  });

  /**
   * A reply is the point of this one, and `senderFor` already makes the From a
   * personal mailbox. An explicit reply-to would redirect answers to a role
   * address, and role addresses post in full — sender, subject, body — into a
   * Discord channel via the Zoho bridge. Somebody answering "what would you
   * change first?" is entitled to assume that is a private reply.
   */
  it('leaves reply-to unset, so replies go back to the sender', async () => {
    await userAgedDays(30);

    await runLifecycleSweep();

    expect(enqueued[0]?.replyTo).toBeUndefined();
  });
});

describe('every lifecycle email', () => {
  it('carries a one-click unsubscribe and a visible link', async () => {
    await userAgedDays(7);

    await runLifecycleSweep();

    expect(enqueued[0]?.unsubscribeUrl).toContain('/v1/email/unsubscribe?token=');
    expect(enqueued[0]?.html).toContain('/unsubscribe?token=');
  });

  /**
   * The campaign belongs on the send and in the client reference, never in the
   * `email.kind` metric label — see `metrics.ts` on bounded cardinality.
   */
  it('names its campaign', async () => {
    await userAgedDays(7);

    await runLifecycleSweep();

    expect(enqueued[0]?.campaign).toBe('onboarding-day7');
    expect(enqueued[0]?.kind).toBe('onboarding-day7');
  });

  it('does not tag the unsubscribe link as campaign traffic', async () => {
    await userAgedDays(7);

    await runLifecycleSweep();

    const html = enqueued[0]?.html ?? '';
    const unsubscribeHref = html.slice(html.indexOf('/unsubscribe?token='));
    expect(unsubscribeHref.slice(0, unsubscribeHref.indexOf('"'))).not.toContain('utm_');
  });
});

describe('when lifecycle email is not live', () => {
  let mayReallySend: MockInstance;

  beforeEach(() => {
    mayReallySend = vi.spyOn(lifecycleGate, 'mayReallySend').mockReturnValue(false);
  });

  afterEach(() => {
    mayReallySend.mockRestore();
  });

  it('sends nothing', async () => {
    await userAgedDays(7);
    await userAgedDays(30);

    await runLifecycleSweep();

    expect(enqueued).toHaveLength(0);
  });

  /**
   * THE ONE THAT MATTERS. A dry run that claimed would record a send it never
   * made, and the day somebody flips the switch every account swept in the
   * meantime is skipped as already-done — a launch that mails nobody and looks
   * from the logs exactly like a launch that worked.
   */
  it('records nothing, so turning it on later still reaches these people', async () => {
    const user = await userAgedDays(7);

    await runLifecycleSweep();
    expect(await EmailLifecycleSend.countBy({ userId: user.id })).toBe(0);

    mayReallySend.mockReturnValue(true);
    await runLifecycleSweep();

    expect(kindsSent()).toEqual(['onboarding-day7']);
  });

  /**
   * The dry run has to do the real work up to the send, or it reports on a
   * different question than the one being asked.
   */
  it('still resolves which variant it would have sent', async () => {
    const user = await userAgedDays(7);
    await UserActivity.save(UserActivity.create({ userId: user.id, activityType: ActivityType.SEARCH }));

    await runLifecycleSweep();

    mayReallySend.mockReturnValue(true);
    await runLifecycleSweep();

    expect(enqueued[0]?.html).toContain('utm_campaign=onboarding-day7-anki');
  });
});

describe('the allowlist', () => {
  /**
   * The staging post between off and everyone: one real send, the rest dry.
   * Checked per recipient rather than as a global switch, so this is a test of
   * the real path rather than of a different one.
   */
  it('sends to the listed address and dry-runs everybody else', async () => {
    const listed = await userAgedDays(7);
    await userAgedDays(7);
    await userAgedDays(7);

    const spy = vi
      .spyOn(lifecycleGate, 'mayReallySend')
      .mockImplementation((address: string) => address === listed.email);

    try {
      await runLifecycleSweep();
    } finally {
      spy.mockRestore();
    }

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.to).toBe(listed.email);
    expect(await EmailLifecycleSend.countBy({ userId: listed.id })).toBe(1);
  });
});
