import '@config/boot';
import { QueryFailedError } from 'typeorm';
import { AppDataSource } from '@config/database';
import { logger } from '@config/log';
import { EmailLifecycleSend, User, UserActivity } from '@app/models';
import { sendFeedbackAskEmail } from '@app/mailers/email';
import { acceptsProductEmails } from '@app/services/email/unsubscribe';
import { describeLifecycleGate, mayReallySend } from '@app/services/email/lifecycleGate';

/** One-time, capped catch-up for accounts beyond the day-7 sweep; run manually so repeat runs stay safe and do not
 * bulk-send through the transactional mail agent. Usage: `npm run email:backfill-feedback -w backend -- [--send
 * --limit 25]`. */

const BATCH_DEFAULT = 25;

/** The sweep owns days 7–8; this job owns older accounts, so their claims cannot race. */
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

/** Oldest first makes capped or interrupted runs deterministic and serves the longest-waiting accounts first. */
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

    // Count before applying the cap: it measures remaining nights and checks that exclusions are not broader than
    // intended.
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
