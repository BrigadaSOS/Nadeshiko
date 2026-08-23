import { getMeter } from '@config/telemetry';
import { EMAIL_EVENTS, SUPPRESSION_CAUSES } from '@app/models';
import type { SuppressionCause } from '@app/models';

/**
 * What we can see about outbound mail, which until this module existed was
 * nothing at all.
 *
 * Two of the four send paths are structurally invisible to every other alert we
 * have: `sendMagicLinkEmail` and `sendVerifyNewEmail` are called inline from
 * better-auth and never touch pg-boss, so `NadeshikoJobsFailing` -- the only
 * rule that could previously notice mail failing -- cannot see them. A revoked
 * Send Mail Token would take out sign-in silently.
 *
 * CARDINALITY IS BOUNDED BY CONSTRUCTION for all six, which is the bar this repo
 * sets at every metric definition: four kinds, five events, four causes, three
 * reject reasons, one block reason. The one unbounded label is `error.type` on
 * the delivery-error counter, which is an exception class name -- the same
 * attribute `recordError` already publishes, and tiny in practice.
 *
 * The recipient address appears on NONE of them. It is unbounded and it is
 * personal; it belongs in the database rows where it is the subject of the
 * record, not in a metric label.
 */
const meter = getMeter();

/**
 * The DENOMINATOR for everything else here.
 *
 * ZeptoMail has no "delivered" webhook, so a delivery rate cannot be read off the
 * events alone: what we know is how many we handed over (this) minus how many
 * came back (below). Every rate-shaped alert divides by this counter, which is
 * also why it is seeded at zero -- a numerator over a denominator that does not
 * exist is not zero, it is nothing.
 */
const emailSent = meter.createCounter('email.sent', {
  description: 'Messages handed to the SMTP relay, by kind',
  unit: '{message}',
});

/** Events ZeptoMail sent back: hard_bounce, soft_bounce, complaint, open, click. */
const emailEvents = meter.createCounter('email.events', {
  description: 'Delivery events received from ZeptoMail, by event',
  unit: '{event}',
});

/**
 * The relay refusing us AT HANDOFF, by exception class.
 *
 * Distinct from a bounce on purpose. A bounce is one bad address; this is
 * ZeptoMail declining to take the message at all, which is almost always about
 * US (a revoked Send Mail Token, an Agent over its daily blocking limit) and
 * affects every recipient equally.
 *
 * DELIBERATELY NOT WIRED TO SUPPRESSION. A 5xx here does not reliably name a
 * recipient, so treating it as a per-address verdict would suppress every user we
 * tried to write to during an account-level block. The webhook is the per-address
 * authority; this is the alarm on the relay.
 */
const emailDeliveryErrors = meter.createCounter('email.delivery_errors', {
  description: 'Messages the SMTP relay refused at handoff, by error type',
  unit: '{message}',
});

/**
 * Messages the suppression check stopped before they reached the relay. A send we
 * correctly did not make, which is a good number to see and a bad one to see
 * growing.
 */
const emailBlocked = meter.createCounter('email.blocked', {
  description: 'Messages not sent because the recipient is suppressed',
  unit: '{message}',
});

/**
 * Webhook deliveries we refused, by reason.
 *
 * Without this a rotated key is invisible: a webhook nobody can authenticate
 * looks exactly like nobody bouncing.
 */
const emailWebhookRejected = meter.createCounter('email.webhook_rejected', {
  description: 'ZeptoMail webhook deliveries refused, by reason',
  unit: '{request}',
});

export const WEBHOOK_REJECT_REASONS = ['no_secret', 'unauthenticated', 'unparseable'] as const;

export type WebhookRejectReason = (typeof WEBHOOK_REJECT_REASONS)[number];

/**
 * `unknown` is not a message we send. It is what a job enqueued by the previous
 * deploy becomes after a rollout that added this field: counted honestly rather
 * than misattributed to whichever kind happened to be first in the union.
 */
/**
 * Every message the app can send, and the whole of the `email.kind` label.
 *
 * BOUNDED BY CONSTRUCTION, like everything else in this file. The lifecycle
 * kinds are the general shape of the mail, never the individual send: the recap
 * is `recap`, not `recap-2026-08`. A per-month label would grow the series count
 * without limit and quietly turn every rate alert that divides by `email.sent`
 * into a division across buckets that do not line up. The specific campaign
 * lives in `EmailLifecycleSend` and in the client reference, where it is a value
 * rather than a dimension.
 */
export type EmailKind =
  | 'welcome'
  | 'magic-link'
  | 'verify-new-email'
  | 'feedback'
  | 'feedback-ask'
  | 'dormant-30'
  | 'recap'
  | 'unknown';

export const EMAIL_KINDS: readonly EmailKind[] = [
  'welcome',
  'magic-link',
  'verify-new-email',
  'feedback',
  'feedback-ask',
  'dormant-30',
  'recap',
  'unknown',
];

export function recordEmailSent(kind: EmailKind): void {
  emailSent.add(1, { 'email.kind': kind });
}

export function recordEmailEvent(event: string): void {
  emailEvents.add(1, { 'email.event': event });
}

export function recordEmailDeliveryError(errorType: string): void {
  emailDeliveryErrors.add(1, { 'error.type': errorType });
}

export function recordEmailBlocked(): void {
  emailBlocked.add(1, { 'email.reason': 'suppressed' });
}

export function recordWebhookRejected(reason: WebhookRejectReason): void {
  emailWebhookRejected.add(1, { 'email.reason': reason });
}

/**
 * Addresses we will not write to again, by cause. A LEVEL, not a rate.
 *
 * Registered as an observable so the number is read at scrape time from the one
 * place that cannot drift -- the table itself -- rather than maintained by
 * increments that a manual row deletion would silently desynchronize.
 *
 * Every cause is reported every scrape, ZEROS INCLUDED. A cause that vanishes
 * from the output when its last row is lifted leaves a gap in the graph that
 * reads like a scrape failure rather than like good news.
 */
export function registerSuppressionGauge(countByCause: () => Promise<Record<string, number>>): void {
  const gauge = meter.createObservableGauge('email.suppressions', {
    description: 'Addresses on the suppression list, by cause',
    unit: '{address}',
  });

  gauge.addCallback(async (result) => {
    let counts: Record<string, number>;
    try {
      counts = await countByCause();
    } catch {
      // A scrape must not be the thing that takes the process down, and a
      // database that cannot answer is already reported by its own metrics.
      // Reporting nothing is honest here; reporting zeros would not be.
      return;
    }

    for (const cause of SUPPRESSION_CAUSES) {
      result.observe(counts[cause] ?? 0, { 'email.cause': cause });
    }
  });
}

/**
 * Create every series this module can produce, at zero, before anything happens.
 *
 * THIS IS NOT COSMETIC. A counter that has never been incremented has no series,
 * and `increase(...) > 0` over a metric with no series evaluates to NO DATA
 * rather than to false. The alert rule cannot fire, and a rule matching nothing
 * looks exactly like a healthy service. Shirabe shipped the same feature without
 * this and four of its five rules were inert until somebody noticed.
 *
 * `email.delivery_errors` is deliberately absent: its label is an exception class
 * name, which cannot be enumerated before one happens. Its rule is on
 * NadeshikoAlertRuleMatchesNothing's exclusion list in brigadasos-infra instead.
 */
export function seedEmailSeries(): void {
  for (const kind of EMAIL_KINDS) {
    emailSent.add(0, { 'email.kind': kind });
  }
  for (const event of EMAIL_EVENTS) {
    emailEvents.add(0, { 'email.event': event });
  }
  for (const reason of WEBHOOK_REJECT_REASONS) {
    emailWebhookRejected.add(0, { 'email.reason': reason });
  }
  emailBlocked.add(0, { 'email.reason': 'suppressed' });
}

export type { SuppressionCause };
