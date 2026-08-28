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

/**
 * A reader being here: the better-auth session row, and the `User.last_seen_at`
 * the session hooks move alongside it.
 *
 * BOTH, BECAUSE PRODUCTION WRITES BOTH. Dormancy reads the column now rather
 * than the session table, but the row still has to exist -- `expires_at` is what
 * the day-7 sweep asks about, and a fixture that set only the column would pass
 * for a system that never wrote it. This stands in for `recordLastSeen`.
 *
 * `expires_at` now says only whether somebody could still be signed in, which
 * with a 90-day session is a different question from whether they were here.
 *
 * Written by hand because signing in for real is a whole auth stack away from a
 * worker test. Defaults describe a reader who was here yesterday on a live
 * session, so a test that says nothing about either is not dormant.
 */
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

/**
 * Signing out, which deletes the session row and leaves `last_seen_at` standing.
 * That gap is the whole reason dormancy stopped reading the session table.
 */
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

  /**
   * A range, not "older than seven days". If the sweep misses a few nights, the
   * backlog must not all go out at once: a day-7 email arriving on day 40 is not
   * a day-7 email, and to a relay the batch looks like exactly the thing it is
   * not.
   */
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

  /**
   * ABSENT MEANS FOLLOW THE MASTER. A reader who left before a category existed
   * must not start receiving it because their preferences have no opinion about
   * a key that did not exist when they went.
   */
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

/**
 * ONE EMAIL, TWO OPENINGS, and this is the seam. Which question a reader can
 * answer depends on whether they have used the site -- and that cannot be read
 * from sessions here, because a session lasts 90 days and so is uniformly live
 * at day 7.
 */
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

  /**
   * `UserActivity` is written only for readers who leave `searchHistory` on, so
   * a row of zeroes means "we are not allowed to know" rather than "never
   * searched". Of the two ways to be wrong, asking a quiet reader what they
   * would change is a question they can ignore; telling a daily user they have
   * not started yet says we have not been paying attention.
   */
  it('treats an invisible activity log as having started', async () => {
    await userAgedDays(7, { preferences: { searchHistory: { enabled: false } } });

    await runLifecycleSweep();

    expect(campaignOfAsk()).toBe('feedback-ask-started');
  });
});

describe('the day-7 ask itself', () => {
  /**
   * A reply is the point of this one, and `senderFor` already makes the From a
   * personal mailbox. An explicit reply-to would redirect answers to a role
   * address, and role addresses post in full -- sender, subject, body -- into a
   * Discord channel via the Zoho bridge. Somebody answering "what would you
   * change first?" is entitled to assume that is a private reply.
   */
  /**
   * A reply goes to whichever of the two of us wrote: their `From` is a real
   * mailbox, so the message needs nothing else on it. An explicit reply-to would
   * only be worth adding to point somewhere shared -- and the address it would
   * point at has to be one the Cloudflare catch-all worker does not publish into
   * Discord, which is a question about that worker rather than about this code.
   */
  it('leaves reply-to unset, so replies go back to whoever wrote', async () => {
    await userAgedDays(7);

    await runLifecycleSweep();

    expect(enqueued[0]?.replyTo).toBeUndefined();
  });

  /**
   * The reason it moved off day 30. The production dry run found 0.8 candidates
   * a night there against 3.8 at day 7 -- and a month-30 ask reaches only the
   * people it is already working for, which is a survey of survivors.
   */
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

  /**
   * DORMANCY IS A STATE, NOT AN ANNIVERSARY. Taking only last night's lapses
   * would be self-limiting but would abandon everybody already past thirty days
   * -- half the account base when this shipped -- purely because their lapse
   * date fell before the feature existed.
   */
  it.each([31, 60, 400])('still reaches an account last seen %i days ago', async (days) => {
    const user = await userAgedDays(400);
    await session(user, { lastSeenDaysAgo: days });

    await runLifecycleSweep();

    expect(kindsSent()).toContain('dormant-30');
  });

  /**
   * WHAT KEEPS THE FIRST NIGHT SMALL, now that the window is gone. The backlog
   * drains at this rate instead of going out at once down the relay that also
   * carries every magic link.
   */
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

  /**
   * THE POINT OF `DORMANT_AFTER_DAYS`. Dormancy used to mean "the session has
   * expired", so it moved whenever `expiresIn` did -- raising sessions to ninety
   * days would silently have turned this into a ninety-day win-back. Being away
   * a month is now the question, and still being signed in is not an answer to
   * it.
   */
  it('mails a reader who has been away a month but is still signed in', async () => {
    const user = await userAgedDays(90);
    await session(user, { lastSeenDaysAgo: 31, expiresInDays: 59 });

    await runLifecycleSweep();

    expect(kindsSent()).toContain('dormant-30');
  });

  /**
   * THE REGRESSION THE COLUMN EXISTS FOR. Dormancy used to read the session
   * table, and signing out deletes the row -- so `MAX(updated_at)` went NULL,
   * `NULL < now() - 30 days` is NULL rather than true, and every reader who had
   * ever signed out was silently exempt from the one sweep meant to reach them.
   * `last_seen_at` lives on `User` and survives the delete.
   */
  it('mails a reader who lapsed and then signed out', async () => {
    const user = await userAgedDays(90);
    await session(user, { lastSeenDaysAgo: 31 });
    await signOut(user);

    await runLifecycleSweep();

    expect(kindsSent()).toContain('dormant-30');
  });

  /**
   * Never signed in at all. A null `last_seen_at` coalesces to `created_at`,
   * which under a rule of "has done nothing for thirty days" is an answer rather
   * than the question it used to be treated as.
   */
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

  /**
   * Going quiet is a state, and a reader who comes back and drifts away again
   * has genuinely gone dormant twice -- so the campaign carries the month rather
   * than repeating the kind, and the unique index stops being once-ever.
   */
  it('names the month it noticed, so a later dormancy is a different send', async () => {
    const user = await userAgedDays(90);
    await session(user, { lastSeenDaysAgo: 31 });

    await runLifecycleSweep();

    expect(campaignOf('dormant-30')).toMatch(/^dormant-30-\d{4}-\d{2}$/);
  });

  /**
   * THE ONE THE WINDOW USED TO GIVE FOR FREE. "Has been away thirty days" stays
   * true forever for somebody who never comes back, so without this they would
   * get another note every time the floor expired, for as long as the account
   * exists.
   */
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

  /**
   * An account that never signed in has a `LAST_SEEN` of `created_at`, which
   * never moves -- so `sent_at > LAST_SEEN` stays true forever and the one note
   * they get is the only one. Worth pinning: the floor alone would let a second
   * through after 180 days, to somebody who has still never been here.
   */
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
  /**
   * The denominator. `EmailLifecycleSend` knows who got what but lives in
   * Postgres; `email.sent` is labelled by kind only so alert rules stay
   * readable. This is the only record that lands on the same PostHog person as
   * the reader's own pageviews, which is what makes a click a rate rather than
   * a count.
   */
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

  /**
   * The campaign belongs on the send and in the client reference, never in the
   * `email.kind` metric label — see `metrics.ts` on bounded cardinality.
   */
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

    expect(kindsSent()).toEqual(['feedback-ask']);
  });

  /**
   * The dry run has to do the real work up to the send, or it reports on a
   * different question than the one being asked -- here, that it resolved the
   * day-7 split rather than counting everybody as one bucket.
   */
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
