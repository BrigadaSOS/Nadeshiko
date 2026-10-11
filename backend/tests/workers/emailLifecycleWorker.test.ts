import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { setupTestSuite } from '../helpers/setup';
import * as emailQueueModule from '@app/workers/emailQueue';
import * as lifecycleGate from '@app/services/email/lifecycleGate';
import * as analytics from '@app/services/analytics/posthog';
import { EmailLifecycleSend, EmailSuppression, User, UserActivity } from '@app/models';
import { ActivityType } from '@app/models/UserActivity';
import { DORMANT_NIGHTLY_CAP, DORMANT_REPEAT_FLOOR_DAYS, runLifecycleSweep } from '@app/workers/emailLifecycleWorker';
import type { EmailJobData } from '@app/workers/emailQueue';
import type { DeepPartial } from 'typeorm';

setupTestSuite();

let enqueued: EmailJobData[];
let sendEmailJob: MockInstance;
let captureEmailSent: MockInstance;

beforeEach(() => {
  enqueued = [];
  captureEmailSent = vi.spyOn(analytics, 'captureEmailSent').mockImplementation(() => {});
  sendEmailJob = vi.spyOn(emailQueueModule, 'sendEmailJob').mockImplementation(async (data) => {
    enqueued.push(data);
    return 'mock-job-id';
  });
});

afterEach(() => {
  sendEmailJob.mockRestore();
  captureEmailSent.mockRestore();
});

let seq = 0;

/** `created_at` is stamped by TypeORM on insert, so set it afterward when tests need an older age. */
async function userAgedDays(days: number, overrides: DeepPartial<User> = {}): Promise<User> {
  seq += 1;
  // Set TypeORM fixture overrides after `create`; the inline `DeepPartial` can select the array overload and make
  // `save` return `User[]`.
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

/** Represent a reader with both the better-auth session and `last_seen_at`: production writes both, dormancy reads
 * the column, and `expires_at` answers session validity rather than activity. */
async function session(user: User, opts: { lastSeenDaysAgo?: number; expiresInDays?: number } = {}): Promise<void> {
  seq += 1;

  await User.query(
    `INSERT INTO "session" (token, user_id, expires_at, created_at, updated_at)
     VALUES ($1, $2, now() + make_interval(days => $3), now(), now() - make_interval(days => $4))`,
    [`token-${seq}`, user.id, opts.expiresInDays ?? 15, opts.lastSeenDaysAgo ?? 1],
  );

  await User.query(`UPDATE "User" SET last_seen_at = now() - make_interval(days => $1) WHERE id = $2`, [
    opts.lastSeenDaysAgo ?? 1,
    user.id,
  ]);
}

/** Signing out deletes the session but preserves `last_seen_at`; that is why dormancy no longer reads sessions. */
async function signOut(user: User): Promise<void> {
  await User.query(`DELETE FROM "session" WHERE user_id = $1`, [user.id]);
}

const kindsSent = () => enqueued.map((job) => job.kind);

describe('the day-7 sweep', () => {
  it('mails an account that registered seven days ago', async () => {
    const user = await userAgedDays(7);

    await runLifecycleSweep();

    expect(kindsSent()).toEqual(['feedback-ask']);
    expect(enqueued[0]?.to).toBe(user.email);
  });

  /** Use a bounded age range, not only “older than seven days,” so a missed sweep does not release an old backlog as
   * new day-7 mail. */
  it.each([0, 3, 6, 9, 40])('leaves an account aged %i days alone', async (age) => {
    await userAgedDays(age);

    await runLifecycleSweep();

    expect(kindsSent()).not.toContain('feedback-ask');
  });

  it('sends once even when the sweep runs twice the same night', async () => {
    await userAgedDays(7);

    await runLifecycleSweep();
    await runLifecycleSweep();

    expect(kindsSent()).toEqual(['feedback-ask']);
  });

  it('records what it sent, so a later sweep can see it', async () => {
    const user = await userAgedDays(7);

    await runLifecycleSweep();

    const rows = await EmailLifecycleSend.findBy({ userId: user.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('feedback-ask');
  });

  it('respects an opt-out', async () => {
    await userAgedDays(7, { preferences: { productEmails: { enabled: false } } });

    await runLifecycleSweep();

    expect(enqueued).toHaveLength(0);
  });

  /** The finer grain: off for check-ins, still on for everything else. */
  it('respects turning off just this category', async () => {
    await userAgedDays(7, { preferences: { productEmails: { enabled: true, checkins: false } } });

    await runLifecycleSweep();

    expect(enqueued).toHaveLength(0);
  });

  /** Missing categories follow the master preference, so new categories do not re-subscribe readers who opted out. */
  it('does not read a missing category as a fresh yes', async () => {
    await userAgedDays(7, { preferences: { productEmails: { enabled: false } } });

    await runLifecycleSweep();

    expect(enqueued).toHaveLength(0);
  });

  it('still sends when another category is the one turned off', async () => {
    await userAgedDays(7, { preferences: { productEmails: { enabled: true, recap: false } } });

    await runLifecycleSweep();

    expect(kindsSent()).toEqual(['feedback-ask']);
  });

  it('skips a deactivated account', async () => {
    await userAgedDays(7, { isActive: false });

    await runLifecycleSweep();

    expect(enqueued).toHaveLength(0);
  });

  /** Check the send policy before writing a claim row, or an undeliverable account loses its one chance without
   * receiving anything. */
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

/** There are two openings for the same email: the day-7 branch depends on site use, not the 90-day session, which is
 * still live then. */
describe('which question the day-7 ask leads with', () => {
  const campaignOfAsk = () => enqueued.find((job) => job.kind === 'feedback-ask')?.campaign;

  it('asks what they were hoping to find when they have never searched', async () => {
    await userAgedDays(7);

    await runLifecycleSweep();

    expect(campaignOfAsk()).toBe('feedback-ask-cold');
    expect(enqueued[0]?.subject).toBe('What were you hoping to find?');
  });

  it('asks what they would change once they have searched', async () => {
    const user = await userAgedDays(7);
    await UserActivity.save(UserActivity.create({ userId: user.id, activityType: ActivityType.SEARCH }));

    await runLifecycleSweep();

    expect(campaignOfAsk()).toBe('feedback-ask-started');
    expect(enqueued[0]?.subject).toBe('How is Nadeshiko working out?');
  });

  it('sends one email per reader, whichever opening it picked', async () => {
    const started = await userAgedDays(7);
    await UserActivity.save(UserActivity.create({ userId: started.id, activityType: ActivityType.SEARCH }));
    await userAgedDays(7);

    await runLifecycleSweep();

    expect(kindsSent()).toEqual(['feedback-ask', 'feedback-ask']);
    expect(enqueued.map((job) => job.campaign).sort()).toEqual(['feedback-ask-cold', 'feedback-ask-started']);
  });

  /** Zero `UserActivity` means search history is disabled, not that the reader never searched; avoid telling active
   * readers their account is unused. */
  it('treats an invisible activity log as having started', async () => {
    await userAgedDays(7, { preferences: { searchHistory: { enabled: false } } });

    await runLifecycleSweep();

    expect(campaignOfAsk()).toBe('feedback-ask-started');
  });
});

describe('the day-7 ask itself', () => {
  /** Keep replies on the sender’s real mailbox. A role-address reply would expose the private message through the
   * Zoho-to-Discord bridge. */
  /** No explicit `reply-to` is needed while `From` is a real mailbox; adding one would require separately verifying
   * that its catch-all does not publish to Discord. */
  it('leaves reply-to unset, so replies go back to whoever wrote', async () => {
    await userAgedDays(7);

    await runLifecycleSweep();

    expect(enqueued[0]?.replyTo).toBeUndefined();
  });

  /** The campaign moved from day 30 to day 7 after the dry run found more eligible readers at day 7; day 30 mostly
   * measured survivors. */
  it('no longer waits for day 30', async () => {
    const user = await userAgedDays(30);
    await UserActivity.save(UserActivity.create({ userId: user.id, activityType: ActivityType.SEARCH }));

    await runLifecycleSweep();

    expect(kindsSent()).not.toContain('feedback-ask');
  });
});

describe('the dormant win-back note', () => {
  const campaignOf = (kind: string) => enqueued.find((job) => job.kind === kind)?.campaign;

  it('mails a reader nobody has seen for a month', async () => {
    const user = await userAgedDays(90);
    await session(user, { lastSeenDaysAgo: 31 });

    await runLifecycleSweep();

    expect(kindsSent()).toEqual(['dormant-30']);
    expect(enqueued[0]?.to).toBe(user.email);
  });

  /** Dormancy is a current state, not a one-time anniversary; query all readers past the threshold so accounts
   * present before launch are included. */
  it.each([31, 60, 400])('still reaches an account last seen %i days ago', async (days) => {
    const user = await userAgedDays(400);
    await session(user, { lastSeenDaysAgo: days });

    await runLifecycleSweep();

    expect(kindsSent()).toContain('dormant-30');
  });

  /** The unbounded window drains the backlog at the configured rate instead of sending it all at once through the
   * magic-link relay. */
  it('sends no more than the nightly cap, however big the backlog', async () => {
    for (let i = 0; i < DORMANT_NIGHTLY_CAP + 6; i++) {
      const user = await userAgedDays(400);
      await session(user, { lastSeenDaysAgo: 31 + i });
    }

    await runLifecycleSweep();

    expect(kindsSent().filter((kind) => kind === 'dormant-30')).toHaveLength(DORMANT_NIGHTLY_CAP);
  });

  /** Warmest first: last month's leaver is likelier to come back than last year's. */
  it('takes the most recently seen first', async () => {
    const recent = await userAgedDays(400);
    await session(recent, { lastSeenDaysAgo: 31 });
    for (let i = 0; i < DORMANT_NIGHTLY_CAP; i++) {
      const older = await userAgedDays(400);
      await session(older, { lastSeenDaysAgo: 60 + i });
    }

    await runLifecycleSweep();

    expect(enqueued.map((job) => job.to)).toContain(recent.email);
  });

  it('leaves a reader who was here last week alone', async () => {
    const user = await userAgedDays(90);
    await session(user, { lastSeenDaysAgo: 7 });

    await runLifecycleSweep();

    expect(kindsSent()).not.toContain('dormant-30');
  });

  /** Use `DORMANT_AFTER_DAYS`, not session expiry: extending sessions must not silently turn a 30-day win-back into
   * a 90-day one. */
  it('mails a reader who has been away a month but is still signed in', async () => {
    const user = await userAgedDays(90);
    await session(user, { lastSeenDaysAgo: 31, expiresInDays: 59 });

    await runLifecycleSweep();

    expect(kindsSent()).toContain('dormant-30');
  });

  /** Read `last_seen_at`, not session rows: sign-out deletes the session, and the old `MAX(updated_at)` query then
   * made signed-out readers look permanently active. */
  it('mails a reader who lapsed and then signed out', async () => {
    const user = await userAgedDays(90);
    await session(user, { lastSeenDaysAgo: 31 });
    await signOut(user);

    await runLifecycleSweep();

    expect(kindsSent()).toContain('dormant-30');
  });

  /** A never-signed-in account has no activity; coalescing `last_seen_at` to `created_at` must not make that
   * creation timestamp satisfy a later-activity rule. */
  it('mails an account that signed up and never came back', async () => {
    await userAgedDays(90);

    await runLifecycleSweep();

    expect(kindsSent()).toContain('dormant-30');
  });

  /** ...but that coalesce must not reach somebody who only just arrived. */
  it('leaves a new account that has not signed in yet alone', async () => {
    await userAgedDays(5);

    await runLifecycleSweep();

    expect(kindsSent()).not.toContain('dormant-30');
  });

  it('sends once even when the sweep runs twice the same night', async () => {
    const user = await userAgedDays(90);
    await session(user, { lastSeenDaysAgo: 31 });

    await runLifecycleSweep();
    await runLifecycleSweep();

    expect(kindsSent()).toEqual(['dormant-30']);
  });

  /** Dormancy can recur after a reader returns, so the campaign carries the month and the uniqueness rule is not
   * once-ever. */
  it('names the month it noticed, so a later dormancy is a different send', async () => {
    const user = await userAgedDays(90);
    await session(user, { lastSeenDaysAgo: 31 });

    await runLifecycleSweep();

    expect(campaignOf('dormant-30')).toMatch(/^dormant-30-\d{4}-\d{2}$/);
  });

  /** Without a post-send floor, a reader who remains dormant would qualify again whenever the threshold elapsed. */
  it('never writes twice to a reader who has not been back since', async () => {
    const user = await userAgedDays(400);
    await session(user, { lastSeenDaysAgo: 230 });
    await EmailLifecycleSend.save(
      EmailLifecycleSend.create({
        userId: user.id,
        kind: 'dormant-30',
        campaign: 'dormant-30-2026-01',
        // Long past the floor, and still after they were last here.
        sentAt: new Date(Date.now() - (DORMANT_REPEAT_FLOOR_DAYS + 20) * 24 * 60 * 60 * 1000),
      }),
    );

    await runLifecycleSweep();

    expect(kindsSent()).not.toContain('dormant-30');
  });

  /** For a never-signed-in account, `LAST_SEEN = created_at` never moves; the floor prevents a second send after
   * another threshold interval. */
  it('writes once only to an account that never signed in, even past the floor', async () => {
    const user = await userAgedDays(400);
    await EmailLifecycleSend.save(
      EmailLifecycleSend.create({
        userId: user.id,
        kind: 'dormant-30',
        campaign: 'dormant-30-2025-01',
        sentAt: new Date(Date.now() - (DORMANT_REPEAT_FLOOR_DAYS + 1) * 24 * 60 * 60 * 1000),
      }),
    );

    await runLifecycleSweep();

    expect(kindsSent()).not.toContain('dormant-30');
  });

  it('holds off when one went out inside the repeat floor', async () => {
    const user = await userAgedDays(400);
    await session(user, { lastSeenDaysAgo: 31 });
    await EmailLifecycleSend.save(
      EmailLifecycleSend.create({
        userId: user.id,
        kind: 'dormant-30',
        campaign: 'dormant-30-2026-01',
        sentAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      }),
    );

    await runLifecycleSweep();

    expect(kindsSent()).not.toContain('dormant-30');
  });

  /** They came back after the last note and drifted away again: a real second dormancy. */
  it('writes again once they have been back and lapsed a second time', async () => {
    const user = await userAgedDays(400);
    await session(user, { lastSeenDaysAgo: 31 });
    await EmailLifecycleSend.save(
      EmailLifecycleSend.create({
        userId: user.id,
        kind: 'dormant-30',
        campaign: 'dormant-30-2025-01',
        sentAt: new Date(Date.now() - (DORMANT_REPEAT_FLOOR_DAYS + 1) * 24 * 60 * 60 * 1000),
      }),
    );

    await runLifecycleSweep();

    expect(kindsSent()).toContain('dormant-30');
  });

  it('respects an opt-out', async () => {
    const user = await userAgedDays(90, { preferences: { productEmails: { enabled: false } } });
    await session(user, { lastSeenDaysAgo: 31 });

    await runLifecycleSweep();

    expect(enqueued).toHaveLength(0);
  });

  it('does not burn a send on a suppressed address', async () => {
    const user = await userAgedDays(90);
    await session(user, { lastSeenDaysAgo: 31 });
    await EmailSuppression.save(
      EmailSuppression.create({ address: user.email.toLowerCase(), cause: 'hard_bounce', suppressedAt: new Date() }),
    );

    await runLifecycleSweep();

    expect(enqueued).toHaveLength(0);
    expect(await EmailLifecycleSend.countBy({ userId: user.id })).toBe(0);
  });
});

describe('every lifecycle email', () => {
  /** Use PostHog’s person-level denominator for click rate; the email metric is labelled only by kind so alert
   * cardinality stays bounded. */
  it('reports the send to analytics, with the campaign that went out', async () => {
    const user = await userAgedDays(7);

    await runLifecycleSweep();

    expect(captureEmailSent).toHaveBeenCalledWith({
      userId: user.id,
      kind: 'feedback-ask',
      campaign: 'feedback-ask-cold',
    });
  });

  it('reports nothing when the send was only a dry run', async () => {
    const spy = vi.spyOn(lifecycleGate, 'mayReallySend').mockReturnValue(false);
    await userAgedDays(7);

    try {
      await runLifecycleSweep();
    } finally {
      spy.mockRestore();
    }

    expect(captureEmailSent).not.toHaveBeenCalled();
  });

  it('carries a one-click unsubscribe and a visible link', async () => {
    await userAgedDays(7);

    await runLifecycleSweep();

    expect(enqueued[0]?.unsubscribeUrl).toContain('/v1/email/unsubscribe?token=');
    expect(enqueued[0]?.html).toContain('/unsubscribe?token=');
  });

  /** Keep campaign in the send and client reference, not the bounded `email.kind` metric label. */
  it('names its campaign', async () => {
    await userAgedDays(7);

    await runLifecycleSweep();

    expect(enqueued[0]?.campaign).toBe('feedback-ask-cold');
    expect(enqueued[0]?.kind).toBe('feedback-ask');
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

  /** A dry run must not write a claim: otherwise launch skips every swept account while logs falsely show success. */
  it('records nothing, so turning it on later still reaches these people', async () => {
    const user = await userAgedDays(7);

    await runLifecycleSweep();
    expect(await EmailLifecycleSend.countBy({ userId: user.id })).toBe(0);

    mayReallySend.mockReturnValue(true);
    await runLifecycleSweep();

    expect(kindsSent()).toEqual(['feedback-ask']);
  });

  /** Dry-run the real path through day-7 resolution so the result tests the actual split rather than one bucket for
   * everyone. */
  it('still resolves which of the two day-7 emails it would have sent', async () => {
    const user = await userAgedDays(7);
    await UserActivity.save(UserActivity.create({ userId: user.id, activityType: ActivityType.SEARCH }));

    await runLifecycleSweep();

    mayReallySend.mockReturnValue(true);
    await runLifecycleSweep();

    expect(kindsSent()).toEqual(['feedback-ask']);
  });
});

describe('the allowlist', () => {
  /** Test the mixed rollout per recipient: one real send and the rest dry-run must use the same path, not a global
   * shortcut. */
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
