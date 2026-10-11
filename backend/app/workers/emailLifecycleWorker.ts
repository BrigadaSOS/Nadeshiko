import { PgBoss, Job } from 'pg-boss';
import { MoreThan, QueryFailedError } from 'typeorm';
import { EmailLifecycleSend, Media, User } from '@app/models';
import { getMediaCoverUrl } from '@lib/utils/storage';
import { DORMANT_TITLE_SLOTS, type DormantTitle } from '@app/mailers/emailTemplates';
import type { LifecycleKind } from '@app/models';
import { UserActivity } from '@app/models/UserActivity';
import { logger } from '@config/log';
import { sendFeedbackAskEmail, sendDormant30Email } from '@app/mailers/email';
import { acceptsProductEmails, type EmailCategory } from '@app/services/email/unsubscribe';
import { describeLifecycleGate, mayReallySend } from '@app/services/email/lifecycleGate';
import { EMAIL_LIFECYCLE_QUEUE } from './queueNames';
import { instrumentedHandler } from './workerInstrumentation';

/** Sweep at send time so current opt-outs/suppressions apply; claim with the unique insert, and isolate failures
 * between email kinds. */
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

/** Select a one-day candidate window and check suppression before claiming; a delayed sweep must not send stale
 * day-specific mail or consume its claim. */
async function candidates(kind: LifecycleKind, ageDays: number, requireLiveSession = false): Promise<User[]> {
  const query = User.createQueryBuilder('user')
    .where('user.created_at >= now() - make_interval(days => :older)', { older: ageDays + 1 })
    .andWhere('user.created_at < now() - make_interval(days => :newer)', { newer: ageDays })
    .andWhere('user.is_active = true')
    .andWhere(`NOT EXISTS (SELECT 1 FROM "EmailLifecycleSend" s WHERE s.user_id = user.id AND s.kind = :kind)`, {
      kind,
    })
    .andWhere(`NOT EXISTS (SELECT 1 FROM "EmailSuppression" p WHERE p.address = LOWER(user.email))`);

  // Treat no session rows as present for the live-session check; only a known expired session excludes the account.
  if (requireLiveSession) {
    query.andWhere(`COALESCE(${LATEST_SESSION_EXPIRY}, 'infinity') > now()`);
  }

  return query.getMany();
}

/** Use session expiry only to ask whether the account could still be signed in; last-seen is a separate dormancy
 * signal. */
const LATEST_SESSION_EXPIRY = `(SELECT MAX(s.expires_at) FROM "session" s WHERE s.user_id = user.id)`;

/** Use `last_seen_at` across browser and API activity, falling back to `created_at`; it survives sign-out and avoids
 * session-table gaps. */
const LAST_SEEN = `COALESCE(user.last_seen_at, user.created_at)`;

/** Keep dormancy as an explicit threshold independent of session lifetime, so changing session expiry cannot
 * silently change campaign timing. */
export const DORMANT_AFTER_DAYS = 30;

/** How long after one win-back note the next one may go out, however often they drift away. */
export const DORMANT_REPEAT_FLOOR_DAYS = 180;

/** Cap nightly sends to drain an existing dormant backlog gradually instead of abandoning old candidates or flooding
 * the relay. */
export const DORMANT_NIGHTLY_CAP = 25;

/** Select by last-seen dormancy, then apply the nightly cap and repeat floor; a returning reader may receive a
 * later, separately earned win-back. */
async function dormantCandidates(): Promise<User[]> {
  return (
    User.createQueryBuilder('user')
      .where('user.is_active = true')
      .andWhere(`${LAST_SEEN} < now() - make_interval(days => :dormantAfter)`, {
        dormantAfter: DORMANT_AFTER_DAYS,
      })
      .andWhere(`NOT EXISTS (SELECT 1 FROM "EmailSuppression" p WHERE p.address = LOWER(user.email))`)
      // Do not resend until the reader returns, and enforce the repeat floor; a permanently absent account must not
      // receive the same note forever.
      .andWhere(
        `NOT EXISTS (
         SELECT 1 FROM "EmailLifecycleSend" s
         WHERE s.user_id = user.id AND s.kind = 'dormant-30'
           AND (s.sent_at > ${LAST_SEEN} OR s.sent_at >= now() - make_interval(days => :floor))
       )`,
        { floor: DORMANT_REPEAT_FLOOR_DAYS },
      )
      // Send warmest dormant accounts first by descending last-seen time, while the cap lets the older tail drain.
      .orderBy(LAST_SEEN, 'DESC')
      .take(DORMANT_NIGHTLY_CAP)
      .getMany()
  );
}

/** The month a dormancy was noticed, so the same account may go quiet again next year. */
export function dormantCampaign(now = new Date()): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `dormant-30-${now.getUTCFullYear()}-${month}`;
}

/** Use the same `last_seen_at` window for both candidate selection and “titles added,” so the email explains the
 * decision that selected it. */
async function titlesAddedSinceLastVisit(userId: number): Promise<{ count: number; samples: DormantTitle[] }> {
  const rows = (await User.query(`SELECT COALESCE(last_seen_at, created_at) AS last_seen FROM "User" WHERE id = $1`, [
    userId,
  ])) as Array<{ last_seen: Date | null }>;

  const lastSeen = rows[0]?.last_seen;
  if (!lastSeen) return { count: 0, samples: [] };

  const count = await Media.countBy({ createdAt: MoreThan(lastSeen) });

  // Always fill the cover grid, topping up with newest titles while keeping `count` as the honest number added since
  // the visit.
  const media = await Media.find({ order: { createdAt: 'DESC' }, take: DORMANT_TITLE_SLOTS });

  return {
    count,
    samples: media.map((title) => ({
      // Prefer English, then romaji, then Japanese so a missing translation leaves a usable caption rather than a blank
      // one.
      name: title.nameEn || title.nameRomaji || title.nameJa,
      coverUrl: getMediaCoverUrl(title),
      // Pass a site path; the builder adds a recipient-bound token to the return link.
      path: `/media/${title.slug}`,
    })),
  };
}

/** Let the unique insert claim the send atomically; check-then-insert would allow two workers to send through the
 * race window. */
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

/** Name the shared category once because a wrong lifecycle category silently bypasses the reader's opt-out. */
const CHECKINS: EmailCategory = 'checkins';

/** How long we let a new account settle before asking it anything. */
export const FEEDBACK_ASK_AGE_DAYS = 7;

/** Keep one day-7 sweep with `hasStarted` selecting the question; the campaign reference and claim must describe the
 * same variant. */
async function sweepFeedbackAsk(): Promise<void> {
  const users = await candidates('feedback-ask', FEEDBACK_ASK_AGE_DAYS);
  let sent = 0;
  let wouldSend = 0;

  for (const user of users) {
    if (!acceptsProductEmails(user.preferences, CHECKINS)) continue;

    const started = await hasStarted(user);
    const campaign = started ? 'feedback-ask-started' : 'feedback-ask-cold';

    // Return from dry-run before `claim`; otherwise disabled sends would consume claims and make the later launch skip
    // recipients.
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

/** If activity is hidden by consent, treat it as used rather than “never used”; zero activity is not evidence when
 * the log is intentionally absent. */
async function hasStarted(user: User): Promise<boolean> {
  const activityVisible = user.preferences?.searchHistory?.enabled !== false;
  if (!activityVisible) return true;

  const stats = await UserActivity.getStatsForUser(user.id);

  return stats.totalSearches > 0;
}
