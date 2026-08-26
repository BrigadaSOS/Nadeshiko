import { PgBoss, Job } from 'pg-boss';
import { MoreThan, QueryFailedError } from 'typeorm';
import { EmailLifecycleSend, Media, User } from '@app/models';
import { getMediaCoverUrl } from '@lib/utils/storage';
import { DORMANT_TITLE_SLOTS, type DormantTitle, withCampaignTags } from '@app/mailers/emailTemplates';
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
 * When this account's newest session runs out.
 *
 * ONLY ASKS WHETHER THEY COULD STILL BE SIGNED IN, which is all `candidates`
 * wants it for. It used to stand in for last-seen as well, and that reading is
 * gone -- see `DORMANT_AFTER_DAYS`.
 */
const LATEST_SESSION_EXPIRY = `(SELECT MAX(s.expires_at) FROM "session" s WHERE s.user_id = user.id)`;

/**
 * When they were last actually here, as opposed to when the lease on that runs
 * out. The closest thing to a last-seen timestamp the schema has.
 *
 * Accurate to within a week rather than to the minute: better-auth refreshes a
 * session on use at most every seven days (`updateAge` in `config/auth.ts`), so
 * `updated_at` moves in steps. Against a thirty-day threshold that is noise, not
 * error -- it means dormancy is noticed somewhere between day 30 and day 37.
 *
 * NULL for an account with no session rows at all, which every comparison below
 * reads as "not a match". An account that has never signed in, or signed out and
 * had its row deleted, is a question we cannot answer rather than a lapse we can
 * point at, and it is not worth mailing on a guess.
 *
 * HAS A KNOWN EXPIRY DATE, and it is not this file's to schedule. Sessions are
 * never swept, which is the only reason expired rows are still here to be
 * counted -- the `last_seen_at` migration calls that "a de-facto access log" and
 * says a sweep is coming. `User.last_seen_at` is the replacement and is strictly
 * better (a plain column, and it survives an explicit sign-out), but it was
 * added with NO BACKFILL, so it is null for exactly the population this sweep
 * exists to reach. Move to it when `scripts/backfill-session-country.ts` has
 * seeded the history, and before any sweep deletes the rows underneath this.
 */
const LATEST_SESSION_SEEN = `(SELECT MAX(s.updated_at) FROM "session" s WHERE s.user_id = user.id)`;

/**
 * How long away counts as dormant.
 *
 * A NUMBER RATHER THAN A SIDE EFFECT OF THE SESSION LIFETIME, which is the whole
 * point of it existing. This used to be `MAX(expires_at) < now()`: true exactly
 * when better-auth's thirty-day session had run out, so "dormant" was not a
 * threshold anybody had chosen -- it was `expiresIn` read through a join, and
 * changing one silently changed the other. Extending sessions to ninety days
 * would have turned this email into a ninety-day win-back without a line of it
 * changing, campaign name and copy included.
 *
 * Now the two are independent: sessions last as long as is comfortable, and this
 * says how long away is long enough to be worth a note.
 */
export const DORMANT_AFTER_DAYS = 30;

/** How long after one win-back note the next one may go out, however often they drift away. */
export const DORMANT_REPEAT_FLOOR_DAYS = 180;

/**
 * How many win-back notes may go out on one night.
 *
 * THE CAP IS WHAT MAKES "DORMANT" A STATE RATHER THAN AN ANNIVERSARY. Taking
 * only the accounts that crossed thirty days LAST NIGHT is self-limiting, but it
 * also abandons everybody already past it -- 331 accounts when this shipped,
 * half the base, who would never hear from us again purely because their lapse
 * date fell before the feature existed.
 *
 * So the query asks the honest question -- has this account been away thirty
 * days -- and the cap handles the consequence: the first nights drain the
 * backlog twenty-five at a time rather than mailing 331 people at once down the
 * relay that also carries every magic link. At about three fresh lapses a night
 * the backlog clears in a fortnight and this stops binding on its own.
 */
export const DORMANT_NIGHTLY_CAP = 25;

/**
 * Accounts nobody has been seen on for `DORMANT_AFTER_DAYS`.
 *
 * ASKS THE HONEST QUESTION AND LETS THE CAP HANDLE THE CONSEQUENCE. "Has not
 * been here for thirty days" is true of a large share of every account ever
 * created, so this matches hundreds on any given night -- through a relay that
 * is transactional-only by its own terms and also carries every magic link. The
 * alternative was to ask only for the accounts that crossed the line LAST NIGHT,
 * which is self-limiting but abandons everybody already past it. See
 * `DORMANT_NIGHTLY_CAP` for why draining a backlog beat never mailing it.
 *
 * READS LAST-SEEN, NOT SESSION EXPIRY. Those were the same question while
 * sessions lasted exactly as long as the dormancy threshold; they are not the
 * same question, and tying this to `expiresIn` meant the definition moved
 * whenever the session lifetime did.
 *
 * The floor on top is for the reader who returns, drifts, returns and drifts
 * again. Going quiet a second time is a real second dormancy and worth one more
 * note, but not more than about twice a year.
 */
async function dormantCandidates(): Promise<User[]> {
  return (
    User.createQueryBuilder('user')
      .where('user.is_active = true')
      .andWhere(`${LATEST_SESSION_SEEN} < now() - make_interval(days => :dormantAfter)`, {
        dormantAfter: DORMANT_AFTER_DAYS,
      })
      .andWhere(`NOT EXISTS (SELECT 1 FROM "EmailSuppression" p WHERE p.address = LOWER(user.email))`)
      // NOT AGAIN UNLESS THEY CAME BACK, which is two conditions and both matter.
      //
      // The first is what the one-night window used to enforce for free. Now
      // that the query asks "has this account been away thirty days" rather than
      // "did it cross thirty days last night", somebody who never returns stays
      // a match forever -- so without this they would get another note every
      // time the floor expired, for as long as the account exists. Comparing our
      // last send against their last sign-in says it plainly: if we wrote more
      // recently than they were here, they have not been back and there is
      // nothing new to tell them.
      //
      // The second is the floor, for the reader who does bounce in and out.
      // Coming back and drifting away again is a real second dormancy and worth
      // one more note, but not more than about twice a year.
      .andWhere(
        `NOT EXISTS (
         SELECT 1 FROM "EmailLifecycleSend" s
         WHERE s.user_id = user.id AND s.kind = 'dormant-30'
           AND (s.sent_at > ${LATEST_SESSION_SEEN} OR s.sent_at >= now() - make_interval(days => :floor))
       )`,
        { floor: DORMANT_REPEAT_FLOOR_DAYS },
      )
      // Most recently seen first, because they are the warmest: somebody who
      // went quiet last month is likelier to come back than somebody who left a
      // year ago, and the long tail still drains behind them.
      .orderBy(LATEST_SESSION_SEEN, 'DESC')
      .take(DORMANT_NIGHTLY_CAP)
      .getMany()
  );
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

  const count = await Media.countBy({ createdAt: MoreThan(lastSeen) });

  // ALWAYS A FULL GRID, topped up with the newest titles overall when fewer
  // than that many arrived while they were away.
  //
  // The reason is what the covers are for. `count` is the argument -- it has to
  // stay the honest number of titles added since their visit, and it does. The
  // grid is the *pull*: eight covers somebody recognises is a reason to come
  // back, and two covers is a reason to think nothing happens here. Ingest is
  // bursty enough that a thirty-day lapser usually lands in a quiet stretch and
  // would otherwise get a two-cover email arguing against itself.
  //
  // Newest first either way, so the genuinely new ones lead.
  const media = await Media.find({ order: { createdAt: 'DESC' }, take: DORMANT_TITLE_SLOTS });

  return {
    count,
    samples: media.map((title, index) => ({
      // English first because the mail is English. Falling through the other two
      // matters more than it looks: a title with no English name would otherwise
      // render as an empty caption under a cover, which reads as a broken email
      // rather than as a missing translation.
      name: title.nameEn || title.nameRomaji || title.nameJa,
      coverUrl: getMediaCoverUrl(title),
      // TAGGED BY POSITION, not just as "a cover". Untagged, a click on a title
      // is indistinguishable from any other visit and the one thing this email
      // is actually testing -- whether showing what is here beats saying how
      // much was added -- cannot be read off.
      url: withCampaignTags(`/media/${title.slug}`, 'dormant-30', `title-${index + 1}`),
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
 * production dry run found under one candidate a night against three at day 7 --
 * and a month-30 ask only ever reaches the people it is already working for,
 * which is a survey of survivors. A week in, the impression is fresh and the
 * population still includes the people who are about to drift away.
 *
 * Seven is probably still late for the half who never searched. Splitting the
 * cold branch onto its own earlier schedule is a real option, deliberately not
 * taken yet: there is no point building two schedules before knowing the first
 * gets answered at all. `FEEDBACK_ASK_AGE_DAYS` is where that change starts.
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
