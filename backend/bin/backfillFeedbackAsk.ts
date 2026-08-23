import '@config/boot';
import { QueryFailedError } from 'typeorm';
import { AppDataSource } from '@config/database';
import { logger } from '@config/log';
import { EmailLifecycleSend, User, UserActivity } from '@app/models';
import { sendFeedbackAskEmail } from '@app/mailers/email';
import { acceptsProductEmails } from '@app/services/email/unsubscribe';
import { describeLifecycleGate, mayReallySend } from '@app/services/email/lifecycleGate';

/**
 * The one-time catch-up for accounts that were already older than a week when
 * the day-7 feedback ask started running.
 *
 *   npm run email:backfill-feedback -w backend            # counts, sends nothing
 *   npm run email:backfill-feedback -w backend -- --send --limit 25
 *
 * A SCRIPT RATHER THAN A SWEEP, and the distinction is the whole design. The
 * nightly sweep asks an anniversary question -- who turned seven days old last
 * night -- which is self-limiting: yesterday's signups are a handful and there
 * is never a backlog. "Everybody who is already older than that" is a standing
 * population, and on the day it first runs that is most of the account base at
 * once. Putting it in the sweep would mean a job that sends four emails a night
 * forever, except for one night when it sends several hundred.
 *
 * Several hundred is not a volume problem, it is a reputation problem: they
 * would go down the ZeptoMail Agent that also carries every magic link, which
 * is transactional-only by its own terms, and a sudden identical-content batch
 * from a sending identity that has never done one is what a relay is watching
 * for. Losing that Agent means losing sign-in.
 *
 * Hence: run by hand, capped per run, and safe to run again tomorrow. Take a
 * few nights over it. `EmailLifecycleSend` is what makes repeat runs safe --
 * the same unique index the sweep claims against -- so this can never double up
 * with the nightly job or with itself.
 */

const BATCH_DEFAULT = 25;

/**
 * Older than the nightly window, so the two cannot both pick up the same
 * account on the same night and race for the claim. The sweep owns days 7 to 8;
 * this owns everything past that.
 */
const OLDER_THAN_DAYS = 8;

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;

  const value = Number(process.argv[index + 1]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * Everyone eligible, oldest account first.
 *
 * Oldest first so that a run that is interrupted, or a cap that is smaller than
 * the backlog, leaves a predictable remainder rather than a random one -- and so
 * the people who have been waiting longest for the question get asked first.
 */
async function backlog(): Promise<User[]> {
  return User.createQueryBuilder('user')
    .where('user.created_at < now() - make_interval(days => :older)', { older: OLDER_THAN_DAYS })
    .andWhere('user.is_active = true')
    .andWhere(`NOT EXISTS (SELECT 1 FROM "EmailLifecycleSend" s WHERE s.user_id = user.id AND s.kind = 'feedback-ask')`)
    .andWhere(`NOT EXISTS (SELECT 1 FROM "EmailSuppression" p WHERE p.address = LOWER(user.email))`)
    .orderBy('user.created_at', 'ASC')
    .getMany();
}

/** Which of the two openings this reader gets. See `hasStarted` in the worker. */
async function hasStarted(user: User): Promise<boolean> {
  if (user.preferences?.searchHistory?.enabled === false) return true;

  const stats = await UserActivity.getStatsForUser(user.id);
  return stats.totalSearches > 0;
}

/** Claim the right to send, or discover the sweep already has. See the worker. */
async function claim(userId: number, campaign: string): Promise<boolean> {
  try {
    await EmailLifecycleSend.insert({
      userId,
      kind: 'feedback-ask',
      campaign,
      sentAt: new Date(),
    });
    return true;
  } catch (error) {
    if (error instanceof QueryFailedError && (error.driverError as { code?: string })?.code === '23505') {
      return false;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const send = flag('send');
  const limit = option('limit', BATCH_DEFAULT);

  await AppDataSource.initialize();

  try {
    logger.info({ gate: describeLifecycleGate() }, 'Feedback-ask backfill starting');

    const candidates = await backlog();
    const eligible: User[] = [];

    for (const user of candidates) {
      if (!acceptsProductEmails(user.preferences, 'checkins')) continue;
      eligible.push(user);
    }

    // The count BEFORE the cap, because that is the number worth knowing: it
    // says how many nights of this there are, and it is the sanity check
    // against an exclusion matching more than intended.
    logger.info(
      { accounts: candidates.length, eligible: eligible.length, limit, send },
      send ? 'Sending this batch' : 'Dry run -- pass --send to actually write to these people',
    );

    if (!send) return;

    let sent = 0;
    for (const user of eligible.slice(0, limit)) {
      // Before `claim`, for the reason the sweep spells out: a claim written for
      // a send the gate refuses marks the account as already-asked forever.
      if (!mayReallySend(user.email)) {
        logger.info({ userId: user.id }, 'Would send, but lifecycle email is not live for this recipient');
        continue;
      }

      const started = await hasStarted(user);
      if (!(await claim(user.id, started ? 'feedback-ask-started' : 'feedback-ask-cold'))) continue;

      await sendFeedbackAskEmail({
        userId: user.id,
        username: user.username,
        email: user.email,
        started,
      });
      sent += 1;
    }

    logger.info({ sent, remaining: Math.max(0, eligible.length - sent) }, 'Feedback-ask backfill complete');
  } finally {
    await AppDataSource.destroy();
  }
}

void main();
