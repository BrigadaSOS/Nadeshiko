import { getMeter } from '@config/telemetry';
import { EMAIL_EVENTS, SUPPRESSION_CAUSES } from '@app/models';
import type { SuppressionCause } from '@app/models';

/** Keep metric label cardinality bounded and never label by recipient address; addresses are personal and unbounded. */
const meter = getMeter();

/** Count handoffs as the denominator for delivery rates; zero means no denominator exists, not a successful
 * zero-rate observation. */
const emailSent = meter.createCounter('email.sent', {
  description: 'Messages handed to the SMTP relay, by kind',
  unit: '{message}',
});

/** Events ZeptoMail sent back: hard_bounce, soft_bounce, complaint, open, click. */
const emailEvents = meter.createCounter('email.events', {
  description: 'Delivery events received from ZeptoMail, by event',
  unit: '{event}',
});

/** A handoff refusal is relay-level, not recipient-level; do not suppress every address when a provider-wide 5xx
 * names none. */
const emailDeliveryErrors = meter.createCounter('email.delivery_errors', {
  description: 'Messages the SMTP relay refused at handoff, by error type',
  unit: '{message}',
});

/** Count messages blocked before handoff so a growing suppression problem is visible without pretending a send
 * occurred. */
const emailBlocked = meter.createCounter('email.blocked', {
  description: 'Messages not sent because the recipient is suppressed',
  unit: '{message}',
});

/** Count rejected webhooks separately; an authentication/key problem must not look like an absence of provider
 * bounces. */
const emailWebhookRejected = meter.createCounter('email.webhook_rejected', {
  description: 'ZeptoMail webhook deliveries refused, by reason',
  unit: '{request}',
});

export const WEBHOOK_REJECT_REASONS = ['no_secret', 'unauthenticated', 'unparseable'] as const;

export type WebhookRejectReason = (typeof WEBHOOK_REJECT_REASONS)[number];

/** `unknown` preserves the truth for jobs from before a label existed; never misattribute them to the first current
 * kind. */
/** Keep the `email.kind` label bounded to message kinds, not recurring campaign names; campaign detail belongs in
 * the send record. */
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

/** Read suppression counts from the table at scrape time, including zeroes, so manual row changes cannot
 * desynchronize a maintained counter. */
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
      // If the database cannot answer, omit the gauge rather than report zero; scraping must not take the process down.
      return;
    }

    for (const cause of SUPPRESSION_CAUSES) {
      result.observe(counts[cause] ?? 0, { 'email.cause': cause });
    }
  });
}

/** Seed bounded series at zero so alert expressions see false rather than no data; exception-class delivery errors
 * cannot be pre-enumerated. */
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
