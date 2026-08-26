import { config } from '@config/config';
import { logger } from '@config/log';
import { PostHog } from 'posthog-node';
import type { EmailKind } from '@app/services/email/metrics';

/**
 * Server-side PostHog, used for the handful of facts the browser cannot be
 * trusted to report.
 *
 * The browser reports *why* an account was created -- which feature gate the
 * visitor hit, which provider they picked -- and it is the only place that can,
 * because that story starts before the account exists. What it cannot do is
 * report reliably: a content blocker, a failed request or a closed tab and the
 * signup is simply never counted. Our audience skews technical, so that
 * undercount is not small.
 *
 * So the two halves do different jobs and neither replaces the other:
 *
 * - `account_created` (here) is the count. It fires from better-auth's own
 *   create hook, once per row that reaches the database, and nothing in the
 *   browser can suppress it.
 * - `signup_completed` (browser) is the attribution. Undercounted, but it is the
 *   only one that knows what the account was created for.
 *
 * They deliberately do not share an event name, so nobody has to remember which
 * of two identically named series is the honest one.
 *
 * Both address the same PostHog person because both key on the numeric account
 * id. PostHog's guidance for backend SDKs is exactly this -- pass the same
 * `distinct_id` the frontend identifies with, and never call `identify()` from a
 * backend, which has no anonymous session to merge.
 */

let client: PostHog | null | undefined;

/**
 * The client, or nothing when analytics are not configured.
 *
 * Absent by default outside production: the key is optional, so a local or test
 * run neither needs credentials nor sends anything to a real project. Resolved
 * once and cached, including the "not configured" answer.
 */
function analyticsClient(): PostHog | null {
  if (client !== undefined) return client;

  if (!config.POSTHOG_API_KEY) {
    client = null;
    return client;
  }

  client = new PostHog(config.POSTHOG_API_KEY, {
    host: config.POSTHOG_HOST,
    // The library's defaults (batch at 20, flush every 10s) are what PostHog
    // recommends for a long-running server: batching keeps the capture call off
    // the request's critical path. The cost is that anything still queued at
    // shutdown is lost, which is what `shutdownAnalytics` exists to prevent.
    flushAt: 20,
    flushInterval: 10_000,
  });

  return client;
}

export interface AccountCreatedInput {
  userId: number | string;
  createdAt?: Date | string;
}

/**
 * Records that an account now exists.
 *
 * Never throws and never awaits the network: the caller is better-auth's user
 * creation hook, and a signup must not fail, or even slow down, because an
 * analytics queue is unhappy.
 */
export function captureAccountCreated(input: AccountCreatedInput): void {
  const posthog = analyticsClient();
  if (!posthog) return;

  try {
    posthog.capture({
      // The same key the browser identifies with, so the server's count and the
      // browser's attribution land on one person rather than two.
      distinctId: String(input.userId),
      event: 'account_created',
      properties: {
        // Written from here as well as the browser so that a reader whose client
        // events never arrive still has a dated person rather than a blank one.
        $set_once: {
          account_created_at: toIsoString(input.createdAt) ?? new Date().toISOString(),
        },
      },
    });
  } catch (error) {
    // `capture` only enqueues, so this is close to unreachable -- but "close to"
    // is not a reason to let it reach the sign-up path.
    logger.error({ err: error }, 'Failed to enqueue account_created analytics event');
  }
}

export interface EmailSentInput {
  userId: number | string;
  /** The `EmailKind`, kept as a bounded set so a breakdown stays readable. */
  kind: EmailKind;
  /** Which run of it, e.g. `feedback-ask-cold` or `recap-2026-09`. */
  campaign: string;
}

/**
 * Records that a message actually went out to somebody.
 *
 * THE DENOMINATOR, and it is the only one of the three email stores that can be
 * one. The others answer different questions and neither can answer this:
 *
 * - `EmailLifecycleSend` is the ledger. It knows who got what, which is what
 *   dedupes a second send, but it lives in Postgres and knows nothing about what
 *   the reader did next.
 * - `email.sent` (OTel, see `services/email/metrics`) is operational. It is
 *   deliberately labelled by kind ONLY, because a per-campaign label would grow
 *   the series count without limit and break every alert that divides one email
 *   counter by another.
 *
 * This one lands on the same PostHog person as the reader's own pageviews,
 * keyed on the account id, so a send can be joined to the utm-tagged visit it
 * produced and to whatever they did after. Without it every click is a numerator
 * over nothing.
 *
 * Campaign is a PROPERTY rather than part of the event name, so a recap that
 * runs every month accumulates into one series that can be broken down by
 * period instead of a new event name each time.
 *
 * Never throws and never awaits: this is called on the send path, and a send
 * must not fail because an analytics queue is unhappy.
 */
export function captureEmailSent(input: EmailSentInput): void {
  const posthog = analyticsClient();
  if (!posthog) return;

  try {
    posthog.capture({
      distinctId: String(input.userId),
      event: 'email_sent',
      properties: { kind: input.kind, campaign: input.campaign },
    });
  } catch (error) {
    logger.error({ err: error, kind: input.kind }, 'Failed to enqueue email_sent analytics event');
  }
}

export interface EmailLinkClickedInput {
  userId: number | string;
  /** The `EmailKind` the link was in, matching the `email_sent` it answers. */
  kind: EmailKind;
  /** Which run of it, matching the `email_sent` it answers. */
  campaign: string;
  /** Which link in the message -- `cta`, `title-3`. The old `utm_content`. */
  content: string;
}

/**
 * Records that somebody opened a link we mailed them.
 *
 * THE NUMERATOR `captureEmailSent` HAS BEEN MISSING, and the reason it is
 * recorded here rather than read off `utm_*` is in `services/email/returnLink`:
 * the tags are a claim the browser has to carry back, and the first dormant send
 * proved they arrive stripped from readers and intact from mail scanners --
 * exactly the wrong way round. Keying on the account id instead puts the click
 * on the same PostHog person as the send, with nothing in between able to lose
 * it.
 *
 * ONLY EVER CALLED FOR A HIT WE BELIEVE A PERSON MADE. `classifyHit` has already
 * dropped prefetches, repeats and scanner fan-out by the time this is reached,
 * so this event means a click rather than a fetch. That is what makes it
 * countable without a second filter at query time.
 *
 * Never throws and never awaits: a reader is waiting on the redirect this sits
 * in front of.
 */
export function captureEmailLinkClicked(input: EmailLinkClickedInput): void {
  const posthog = analyticsClient();
  if (!posthog) return;

  try {
    posthog.capture({
      distinctId: String(input.userId),
      event: 'email_link_clicked',
      properties: { kind: input.kind, campaign: input.campaign, content: input.content },
    });
  } catch (error) {
    logger.error({ err: error, kind: input.kind }, 'Failed to enqueue email_link_clicked analytics event');
  }
}

export interface ApiKeyCreatedInput {
  userId: number | string;
  /** The scopes actually granted, after the role ceiling has been applied. */
  scopes: string[];
}

/**
 * Records that an account issued itself an API key.
 *
 * WHY THIS IS WORTH AN EVENT AT ALL, when it happens a handful of times a week.
 * It is the single most misread signal we have. A reader who signs up for API
 * access scores zero on every engagement counter the product has -- no search, no
 * playback, no Anki export -- so the signup channel announces them as a dud and
 * every activation figure counts them as one. Measured over 60 days
 * (2026-08-24): of 21 accounts that searched and played nothing, 11 had opened
 * the API key page. That is not a rounding error in the activation rate, it is a
 * segment being systematically misfiled as failure.
 *
 * The key NAME is deliberately not sent. It is free text the owner chose, so it
 * is the one field here capable of carrying something personal, and no question
 * worth asking needs it -- the scopes say what the key is for.
 *
 * `has_api_key` is set on the person as well as the event so that any later
 * question -- retention, engagement, email response -- can be split by it without
 * re-deriving the segment from the event stream every time.
 */
export function captureApiKeyCreated(input: ApiKeyCreatedInput): void {
  const posthog = analyticsClient();
  if (!posthog) return;

  try {
    posthog.capture({
      distinctId: String(input.userId),
      event: 'api_key_created',
      properties: {
        scopes: input.scopes,
        scope_count: input.scopes.length,
        $set: { has_api_key: true },
        $set_once: { first_api_key_at: new Date().toISOString() },
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to enqueue api_key_created analytics event');
  }
}

/**
 * Remembers which UTC day each account was last seen calling the API on.
 *
 * Bounded by the number of accounts that actually use the API -- a few dozen --
 * because an account's entry is REPLACED when the day rolls over rather than
 * added to. Process-local and deliberately not persisted: see the note on
 * over-counting in `captureApiActiveDay`.
 */
const apiActiveDayByUser = new Map<string, string>();

export interface ApiActiveDayInput {
  userId: number | string;
  /** Month-to-date usage as it stood when the request arrived, before this one. */
  quotaUsed: number;
  quotaLimit: number;
}

/**
 * Records that an account used the API today. ONE EVENT PER ACCOUNT PER DAY, not
 * one per request.
 *
 * THE NAME SAYS `day` BECAUSE THAT IS WHAT IT COUNTS. An `api_request_made` that
 * fired once a day would be a trap: every rate, every "requests per user", every
 * sum over it would be wrong by whatever factor that account's traffic happened
 * to be, and nothing in the series would say so. This module already carries one
 * pair of events that mean different things (`account_created` against the
 * browser's `signup_completed`) and the reason it is survivable is that the names
 * do not pretend to be interchangeable.
 *
 * Per-request capture was the alternative and it is not worth it. A single
 * account can spend 5,000 requests a month inside its quota, so per-request
 * events would be the largest series in the project by a wide margin, bought to
 * answer questions -- who uses the API, how hard, and does it last -- that a
 * daily grain answers just as well. Request VOLUME is already counted exactly, in
 * Postgres, by `AccountQuotaUsage`; `quota_used` below carries that number onto
 * the event so a dashboard can read consumption without joining anything.
 *
 * The dedupe is process-local, and production forks THREE workers (see the tier
 * cache in `middleware/apiLimiterQuota`, which accepts the same limitation for
 * the same reason), so an account can produce up to three events a day, plus one
 * more per deploy. Read this series as `uniq(person_id)` per day and that is
 * invisible; read it as `count()` and it is inflated by up to 3x. The alternative
 * is shared state this backend has no Redis for, to sharpen a number nobody
 * needs sharp.
 */
export function captureApiActiveDay(input: ApiActiveDayInput): void {
  const posthog = analyticsClient();
  if (!posthog) return;

  const userId = String(input.userId);
  const today = new Date().toISOString().slice(0, 10);
  if (apiActiveDayByUser.get(userId) === today) return;
  apiActiveDayByUser.set(userId, today);

  try {
    posthog.capture({
      distinctId: userId,
      event: 'api_active_day',
      properties: {
        quota_used: input.quotaUsed,
        quota_limit: input.quotaLimit,
        $set_once: { first_api_request_at: new Date().toISOString() },
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to enqueue api_active_day analytics event');
  }
}

function toIsoString(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Flushes anything still queued.
 *
 * Without this a deploy silently drops up to ten seconds of signups -- the exact
 * events this module exists to stop losing.
 */
export async function shutdownAnalytics(): Promise<void> {
  if (!client) return;

  try {
    await client.shutdown();
  } catch (error) {
    logger.warn({ err: error }, 'PostHog shutdown did not complete cleanly');
  } finally {
    client = undefined;
  }
}

/**
 * Test seam: drops the memoised client so configuration can be re-read.
 *
 * Clears the API day-dedupe too. Without that, the first test to capture an
 * active day would silence every later one for the same account, and the
 * failure would land on whichever test happened to run second.
 */
export function resetAnalyticsClientForTests(): void {
  client = undefined;
  apiActiveDayByUser.clear();
}
