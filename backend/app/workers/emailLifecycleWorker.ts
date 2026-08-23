import { PgBoss, Job } from 'pg-boss';
import { MoreThan, QueryFailedError } from 'typeorm';
import { EmailLifecycleSend, Media, User } from '@app/models';
import { getMediaCoverUrl } from '@lib/utils/storage';
import { config } from '@config/config';
import { DORMANT_TITLE_SLOTS, type DormantTitle } from '@app/mailers/emailTemplates';
import type { LifecycleKind } from '@app/models';
import { UserActivity } from '@app/models/UserActivity';
import { logger } from '@config/log';
import { sendFeedbackAskEmail, sendDormant30Email } from '@app/mailers/email';
import { acceptsProductEmails, type EmailCategory } from '@app/services/email/unsubscribe';
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

  for (const sweep of [sweepFeedbackAsk, sweepDormant30]) {
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
async function candidates(kind: LifecycleKind, ageDays: number, requireLiveSession = false): Promise<User[]> {
  const query = User.createQueryBuilder('user')
    .where('user.created_at >= now() - make_interval(days => :older)', { older: ageDays + 1 })
    .andWhere('user.created_at < now() - make_interval(days => :newer)', { newer: ageDays })
    .andWhere('user.is_active = true')
    .andWhere(`NOT EXISTS (SELECT 1 FROM "EmailLifecycleSend" s WHERE s.user_id = user.id AND s.kind = :kind)`, {
      kind,
    })
    .andWhere(`NOT EXISTS (SELECT 1 FROM "EmailSuppression" p WHERE p.address = LOWER(user.email))`);

  // COALESCE TO INFINITY, so "we have no session rows for this account" reads as
  // present rather than gone. The only thing that excludes anybody here is a
  // lapse we can point at; an account with no session history at all is a
  // question we cannot answer, and the answer we already shipped is "send".
  if (requireLiveSession) {
    query.andWhere(`COALESCE(${LATEST_SESSION_EXPIRY}, 'infinity') > now()`);
  }

  return query.getMany();
}

/**
 * When this account's newest session runs out, which is the closest thing to a
 * last-seen timestamp the schema has.
 *
 * better-auth gives a session 30 days and refreshes it on use, at most weekly
 * (`expiresIn` / `updateAge` in `config/auth.ts`). So a lapsed newest session
 * means nobody has signed in for 30 days, give or take the seven-day refresh
 * granularity, and no column had to be added to learn it.
 */
const LATEST_SESSION_EXPIRY = `(SELECT MAX(s.expires_at) FROM "session" s WHERE s.user_id = user.id)`;

/** How long after one win-back note the next one may go out, however often they drift away. */
export const DORMANT_REPEAT_FLOOR_DAYS = 180;

/**
 * Accounts whose last session lapsed in the past day.
 *
 * A ONE-DAY WINDOW, and here it is load-bearing rather than tidy. The other two
 * sweeps window an anniversary, where the worst case of getting it wrong is a
 * late email. Dormancy is a STATE: "has not signed in for 30 days" is true of a
 * large share of every account ever created, so the un-windowed version of this
 * query mails hundreds of people the first night it runs -- through a relay that
 * is transactional-only by its own terms and also carries every magic link.
 * Asking instead for the accounts that crossed the line LAST NIGHT turns that
 * into a handful, and gives the first run nothing to backfill.
 *
 * The floor on top is for the reader who returns, drifts, returns and drifts
 * again. Lapsing twice already requires signing in twice, so the physics put at
 * least a session lifetime between two sends; the floor puts half a year there.
 */
async function dormantCandidates(): Promise<User[]> {
  return User.createQueryBuilder('user')
    .where('user.is_active = true')
    .andWhere(`${LATEST_SESSION_EXPIRY} < now()`)
    .andWhere(`${LATEST_SESSION_EXPIRY} >= now() - make_interval(days => 1)`)
    .andWhere(`NOT EXISTS (SELECT 1 FROM "EmailSuppression" p WHERE p.address = LOWER(user.email))`)
    .andWhere(
      `NOT EXISTS (
         SELECT 1 FROM "EmailLifecycleSend" s
         WHERE s.user_id = user.id AND s.kind = 'dormant-30'
           AND s.sent_at >= now() - make_interval(days => :floor)
       )`,
      { floor: DORMANT_REPEAT_FLOOR_DAYS },
    )
    .getMany();
}

/** The month a dormancy was noticed, so the same account may go quiet again next year. */
export function dormantCampaign(now = new Date()): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `dormant-30-${now.getUTCFullYear()}-${month}`;
}

/**
 * What has been added since this reader was last here: how many, and a few of
 * them by name.
 *
 * The count is the argument; the covers are what make it land. "57 new titles"
 * is a number somebody can disbelieve, three covers they recognise is not -- and
 * a reader who left because their show was not in here can see whether that has
 * changed without clicking anything.
 *
 * Reads `updated_at` rather than `expires_at` because it wants when they were
 * last seen, not when the lease on that runs out.
 */
async function titlesAddedSinceLastVisit(userId: number): Promise<{ count: number; samples: DormantTitle[] }> {
  const rows = (await User.query(`SELECT MAX(updated_at) AS last_seen FROM "session" WHERE user_id = $1`, [
    userId,
  ])) as Array<{ last_seen: Date | null }>;

  const lastSeen = rows[0]?.last_seen;
  if (!lastSeen) return { count: 0, samples: [] };

  const [media, count] = await Media.findAndCount({
    where: { createdAt: MoreThan(lastSeen) },
    order: { createdAt: 'DESC' },
    take: DORMANT_TITLE_SLOTS,
  });

  return {
    count,
    samples: media.map((title) => ({
      // English first because the mail is English. Falling through the other two
      // matters more than it looks: a title with no English name would otherwise
      // render as an empty caption under a cover, which reads as a broken email
      // rather than as a missing translation.
      name: title.nameEn || title.nameRomaji || title.nameJa,
      coverUrl: getMediaCoverUrl(title),
      url: `${config.BASE_URL}/media/${title.slug}`,
    })),
  };
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

/**
 * Both sweeps send one-off asks, so both answer to the same category.
 *
 * Named once rather than written at each call site, because the failure of
 * getting it wrong is silent: a sweep asking about the wrong category sends to
 * somebody who switched this exact thing off.
 */
const CHECKINS: EmailCategory = 'checkins';

/** How long we let a new account settle before asking it anything. */
export const FEEDBACK_ASK_AGE_DAYS = 7;

/**
 * The day-7 ask, for everybody a week old.
 *
 * ONE SWEEP, ONE EMAIL, TWO OPENINGS. `hasStarted` decides which question the
 * reader can answer -- what they would change, or what they were hoping to find
 * -- and `buildFeedbackAskEmail` reports back which one it used so the claim row
 * and the client reference agree.
 *
 * DAY 7 RATHER THAN DAY 30, and the numbers are the argument. At day 30 the
 * production dry run found 0.8 candidates a night against 3.8 at day 7 -- and a
 * month-30 ask only ever reaches the people it is already working for, which is
 * a survey of survivors. A week in, the impression is fresh and the population
 * still includes the people who are about to drift away, who are the ones worth
 * hearing from.
 *
 * Seven is probably still late for the half who never searched -- somebody who
 * signs up and does not use a thing is usually gone within hours. Splitting the
 * cold branch onto its own earlier schedule is a real option, and deliberately
 * not taken yet: there is no point building two schedules before knowing the
 * first one gets answered at all. `FEEDBACK_ASK_AGE_DAYS` is where that change
 * starts.
 */
async function sweepFeedbackAsk(): Promise<void> {
  const users = await candidates('feedback-ask', FEEDBACK_ASK_AGE_DAYS);
  let sent = 0;
  let wouldSend = 0;

  for (const user of users) {
    if (!acceptsProductEmails(user.preferences, CHECKINS)) continue;

    const started = await hasStarted(user);
    const campaign = started ? 'feedback-ask-started' : 'feedback-ask-cold';

    // THE DRY-RUN BRANCH RETURNS BEFORE `claim`, and that order is the whole
    // reason this is safe to ship disabled. Claiming first would write a row
    // saying we had sent an email we never sent, and the day somebody enables
    // this every account swept in the meantime would be skipped as already-done
    // -- a launch that mails nobody and looks like it worked.
    if (!mayReallySend(user.email)) {
      wouldSend += 1;
      logger.info(
        { 'email.kind': 'feedback-ask', userId: user.id, campaign },
        'Would send, but lifecycle email is not live for this recipient',
      );
      continue;
    }

    if (!(await claim(user.id, 'feedback-ask', campaign))) continue;

    await sendFeedbackAskEmail({
      userId: user.id,
      username: user.username,
      email: user.email,
      started,
    });
    sent += 1;
  }

  logger.info({ 'email.kind': 'feedback-ask', candidates: users.length, sent, wouldSend }, 'Lifecycle sweep complete');
}

async function sweepDormant30(): Promise<void> {
  const users = await dormantCandidates();
  const campaign = dormantCampaign();
  let sent = 0;
  let wouldSend = 0;

  for (const user of users) {
    if (!acceptsProductEmails(user.preferences, CHECKINS)) continue;

    const added = await titlesAddedSinceLastVisit(user.id);

    // Before `claim`, for the reason spelled out in the day-7 sweep above.
    if (!mayReallySend(user.email)) {
      wouldSend += 1;
      logger.info(
        { 'email.kind': 'dormant-30', userId: user.id, campaign, newTitles: added.count },
        'Would send, but lifecycle email is not live for this recipient',
      );
      continue;
    }

    if (!(await claim(user.id, 'dormant-30', campaign))) continue;

    await sendDormant30Email({
      userId: user.id,
      username: user.username,
      email: user.email,
      campaign,
      newTitles: added.count,
      titles: added.samples,
    });
    sent += 1;
  }

  logger.info({ 'email.kind': 'dormant-30', candidates: users.length, sent, wouldSend }, 'Lifecycle sweep complete');
}

/**
 * Whether this reader has actually used the site, as far as we can honestly
 * tell -- the one question day 7 splits on.
 *
 * `activityVisible` IS THE WHOLE POINT OF THIS FUNCTION. `UserActivity` is
 * written only for readers who leave `searchHistory` on, so for anyone who
 * turned it off the counts are zero for a reason that has nothing to do with
 * whether they use the site. Treating that as "never searched" would send the
 * absolute beginner's email to somebody mining sentences daily -- and the reason
 * we could not tell is that they asked us not to keep the log, which makes
 * guessing from it worse than not guessing at all.
 *
 * So an invisible log answers YES, which routes them to the feedback ask. Of the
 * two ways to be wrong, asking a quiet reader what they would change is a
 * question they can ignore; telling an active one how to run their first search
 * is a message that says we have not been paying attention.
 */
async function hasStarted(user: User): Promise<boolean> {
  const activityVisible = user.preferences?.searchHistory?.enabled !== false;
  if (!activityVisible) return true;

  const stats = await UserActivity.getStatsForUser(user.id);

  return stats.totalSearches > 0;
}
