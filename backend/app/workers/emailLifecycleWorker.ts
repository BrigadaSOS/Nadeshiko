import { PgBoss, Job } from 'pg-boss';
import { QueryFailedError } from 'typeorm';
import { EmailLifecycleSend, User } from '@app/models';
import type { LifecycleKind } from '@app/models';
import { UserActivity } from '@app/models/UserActivity';
import { logger } from '@config/log';
import { sendOnboardingDay7Email, sendFeedbackAskEmail } from '@app/mailers/email';
import type { OnboardingSignals } from '@app/mailers/emailTemplates';
import { pickOnboardingVariant } from '@app/mailers/emailTemplates';
import { acceptsProductEmails } from '@app/services/email/unsubscribe';
import { describeLifecycleGate, mayReallySend } from '@app/services/email/lifecycleGate';
import { EMAIL_LIFECYCLE_QUEUE } from './queueNames';
import { instrumentedHandler } from './workerInstrumentation';

/**
 * The nightly sweep behind every scheduled email.
 *
 * A SWEEP RATHER THAN A DELAYED JOB, which is not the obvious choice and is
 * worth the sentence. pg-boss can hold a job with `startAfter: '7 days'` and
 * would give exact timing -- but `EMAIL_SEND_QUEUE` sets
 * `retentionSeconds: 86400`, and pg-boss counts that against time in the
 * CREATED state, so a seven-day job on that queue is deleted six days before it
 * runs. A separate long-retention queue would fix that and still leave every
 * decision frozen at signup: a reader who unsubscribes on day 3 would have a
 * job already built from their day-0 self. The sweep asks the question on the
 * night it matters, so opt-outs, deletions and suppressions all just work.
 *
 * WHAT MAKES IT SAFE TO RUN TWICE is `EmailLifecycleSend`, not this file. The
 * row goes in before the job is enqueued and the unique index is what actually
 * refuses the second copy -- two workers racing on the same night both reach the
 * insert and one of them loses. See the migration.
 *
 * Each kind is swept independently and a failure in one does not stop the next:
 * an exception thrown out of here fails the whole pg-boss job, and a broken
 * day-7 query must not also mean nobody gets the feedback ask.
 */
export async function registerEmailLifecycleWorker(boss: PgBoss): Promise<void> {
  await boss.work(
    EMAIL_LIFECYCLE_QUEUE,
    instrumentedHandler(EMAIL_LIFECYCLE_QUEUE, async (_jobs: Job[]) => {
      await runLifecycleSweep();
    }),
  );

  logger.info('Email lifecycle worker registered');
}

export async function runLifecycleSweep(): Promise<void> {
  logger.info({ gate: describeLifecycleGate() }, 'Lifecycle email sweep starting');

  for (const sweep of [sweepOnboardingDay7, sweepFeedbackAsk]) {
    try {
      await sweep();
    } catch (error) {
      logger.error({ err: error }, 'A lifecycle email sweep failed');
    }
  }
}

/**
 * Accounts that registered in a one-day window, are still active, still want the
 * mail, and have no address we already know bounces.
 *
 * The window is a range rather than "older than N days" so a sweep that has not
 * run for a week does not mail its entire backlog at once -- a day-7 email
 * arriving on day 40 is not a day-7 email, and the batch would look to a relay
 * exactly like the thing it is not.
 *
 * The suppression check is here as well as inside `sendEmail` on purpose. Left
 * to `sendEmail` alone the send is correctly skipped, but the row has already
 * been written and the account has spent its one chance at this email on a
 * message nobody could have received.
 */
async function candidates(kind: LifecycleKind, ageDays: number): Promise<User[]> {
  return User.createQueryBuilder('user')
    .where('user.created_at >= now() - make_interval(days => :older)', { older: ageDays + 1 })
    .andWhere('user.created_at < now() - make_interval(days => :newer)', { newer: ageDays })
    .andWhere('user.is_active = true')
    .andWhere(`NOT EXISTS (SELECT 1 FROM "EmailLifecycleSend" s WHERE s.user_id = user.id AND s.kind = :kind)`, {
      kind,
    })
    .andWhere(`NOT EXISTS (SELECT 1 FROM "EmailSuppression" p WHERE p.address = LOWER(user.email))`)
    .getMany();
}

/**
 * Claim the right to send, or discover somebody already has.
 *
 * The unique index is the arbiter and the insert is how we ask it. Checking for
 * an existing row first and then inserting would leave the window between the
 * two open, which on a night when the sweep runs twice is the only window that
 * matters.
 */
async function claim(userId: number, kind: LifecycleKind, campaign: string): Promise<boolean> {
  try {
    await EmailLifecycleSend.insert({ userId, kind, campaign, sentAt: new Date() });
    return true;
  } catch (error) {
    // 23505 is unique_violation: somebody else got there first, which is the
    // answer rather than a fault. Anything else is a real failure and belongs
    // with the caller.
    if (error instanceof QueryFailedError && (error.driverError as { code?: string })?.code === '23505') {
      return false;
    }
    throw error;
  }
}

async function sweepOnboardingDay7(): Promise<void> {
  const users = await candidates('onboarding-day7', 7);
  let sent = 0;
  let wouldSend = 0;

  for (const user of users) {
    if (!acceptsProductEmails(user.preferences)) continue;

    const signals = await onboardingSignals(user);

    // THE DRY-RUN BRANCH RETURNS BEFORE `claim`, and that order is the whole
    // reason this is safe to ship disabled. Claiming first would write a row
    // saying we had sent an email we never sent, and the day somebody enables
    // this every account swept in the meantime would be skipped as already-done
    // -- a launch that mails nobody and looks like it worked.
    if (!mayReallySend(user.email)) {
      wouldSend += 1;
      logger.info(
        { 'email.kind': 'onboarding-day7', userId: user.id, variant: pickOnboardingVariant(signals) },
        'Would send, but lifecycle email is not live for this recipient',
      );
      continue;
    }

    if (!(await claim(user.id, 'onboarding-day7', 'onboarding-day7'))) continue;

    await sendOnboardingDay7Email({
      userId: user.id,
      username: user.username,
      email: user.email,
      campaign: 'onboarding-day7',
      signals,
    });
    sent += 1;
  }

  logger.info(
    { 'email.kind': 'onboarding-day7', candidates: users.length, sent, wouldSend },
    'Lifecycle sweep complete',
  );
}

async function sweepFeedbackAsk(): Promise<void> {
  const users = await candidates('feedback-ask', 30);
  let sent = 0;
  let wouldSend = 0;

  for (const user of users) {
    if (!acceptsProductEmails(user.preferences)) continue;

    // Before `claim`, for the reason spelled out in the day-7 sweep above.
    if (!mayReallySend(user.email)) {
      wouldSend += 1;
      logger.info(
        { 'email.kind': 'feedback-ask', userId: user.id },
        'Would send, but lifecycle email is not live for this recipient',
      );
      continue;
    }

    if (!(await claim(user.id, 'feedback-ask', 'feedback-ask'))) continue;

    await sendFeedbackAskEmail({
      userId: user.id,
      username: user.username,
      email: user.email,
      campaign: 'feedback-ask',
    });
    sent += 1;
  }

  logger.info({ 'email.kind': 'feedback-ask', candidates: users.length, sent, wouldSend }, 'Lifecycle sweep complete');
}

/**
 * What we can honestly say about this reader's first week.
 *
 * `activityVisible` IS THE WHOLE POINT OF THIS FUNCTION. `UserActivity` is
 * written only for readers who leave `searchHistory` on, so for anyone who
 * turned it off the counts are zero for a reason that has nothing to do with
 * whether they use the site. Treating that as "never searched" would send the
 * absolute beginner's email to somebody mining sentences daily -- and the reason
 * we could not tell is that they asked us not to keep the log, which makes
 * guessing from it worse than not guessing at all.
 */
async function onboardingSignals(user: User): Promise<OnboardingSignals> {
  const activityVisible = user.preferences?.searchHistory?.enabled !== false;
  // Read before the `activityVisible` early return on purpose: a saved profile
  // is a preference rather than a logged action, so it is the one thing we still
  // know about a reader whose history is off. See `pickOnboardingVariant`.
  const hasAnkiProfile = (user.preferences?.ankiProfiles?.length ?? 0) > 0;

  if (!activityVisible) {
    return { activityVisible, totalSearches: 0, totalExports: 0, hasAnkiProfile };
  }

  const stats = await UserActivity.getStatsForUser(user.id);

  return {
    activityVisible,
    totalSearches: stats.totalSearches,
    totalExports: stats.totalExports,
    hasAnkiProfile,
  };
}
