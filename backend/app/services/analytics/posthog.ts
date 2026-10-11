import { config } from '@config/config';
import { logger } from '@config/log';
import { PostHog } from 'posthog-node';
import type { EmailKind } from '@app/services/email/metrics';

/** Server-side `account_created` supplies a reliable count; browser `signup_completed` supplies attribution, because
 * only the browser knows the signup context. */

let client: PostHog | null | undefined;

/** Cache the configured client, including the absent answer, so local/test runs need no credentials and send no
 * analytics. */
function analyticsClient(): PostHog | null {
  if (client !== undefined) return client;

  if (!config.POSTHOG_API_KEY) {
    client = null;
    return client;
  }

  client = new PostHog(config.POSTHOG_API_KEY, {
    host: config.POSTHOG_HOST,
    // Batch captures off the request path; flush on shutdown so queued events are not lost when the process exits.
    flushAt: 20,
    flushInterval: 10_000,
  });

  return client;
}

export interface AccountCreatedInput {
  userId: number | string;
  createdAt?: Date | string;
  /** Optional signup display name; API-key callers can omit it while the event still records the account. */
  name?: string | null;
  /**
   * The reader's email as captured at signup -- null where the signup flow
   * did not collect one. Optional for the same reason as `name`.
   */
  email?: string | null;
}

/** Never throw or await the network: the account-creation hook must not fail or slow a signup for analytics. */
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
        // Identify the person with `$set` and mirror name/email as queryable fields; this also labels API-key and
        // blocked-browser signups.
        $set: {
          ...(input.name ? { $name: input.name, name: input.name } : {}),
          ...(input.email ? { email: input.email } : {}),
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

/** This is the send denominator, keyed to the account; keep capture non-blocking so mail never fails for analytics. */
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

/** Record only a `classifyHit`-approved human click, keyed to the account rather than a fragile UTM round trip;
 * never block the redirect. */
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

/** Record API-key creation without the user-chosen key name; expose `has_api_key` for later segmentation without
 * sending free text. */
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

/** Replace each account's API-active day in the map rather than accumulating entries; the cache stays bounded by
 * active accounts. */
const apiActiveDayByUser = new Map<string, string>();

export interface ApiActiveDayInput {
  userId: number | string;
  /** Month-to-date usage as it stood when the request arrived, before this one. */
  quotaUsed: number;
  quotaLimit: number;
}

/** The daily dedupe is process-local, so this is not an exactly-once count across workers or deploys; read it as a
 * daily unique-user signal. */
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

/** Flush the queue at shutdown; otherwise a deploy can drop events still waiting in the client. */
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

/** Test seam: reset both the memoized client and the API-day dedupe so tests do not share state. */
export function resetAnalyticsClientForTests(): void {
  client = undefined;
  apiActiveDayByUser.clear();
}
