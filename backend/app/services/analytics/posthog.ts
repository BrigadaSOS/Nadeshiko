import { config } from '@config/config';
import { logger } from '@config/log';
import { PostHog } from 'posthog-node';

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

/** Test seam: drops the memoised client so configuration can be re-read. */
export function resetAnalyticsClientForTests(): void {
  client = undefined;
}
