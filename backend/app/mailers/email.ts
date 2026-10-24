import nodemailer from 'nodemailer';
import { config } from '@config/config';
import { logger } from '@config/log';
import {
  buildWelcomeEmail,
  buildVerifyNewEmailEmail,
  buildMagicLinkEmail,
  buildFeedbackEmail,
  buildFeedbackAskEmail,
  buildDormant30Email,
  type DormantTitle,
  type FeedbackEmailInput,
} from './emailTemplates';
import { createLetterOpenerTransport, getPreviewUrl, LETTER_OPENER_DIR } from './letterOpener';
import { htmlToPlainText } from './plainText';
import { sendViaSes, type OutboundMessage } from './sesSend';
import { sendEmailJob } from '@app/workers/emailQueue';
import { getTracer } from '@config/telemetry';
import { recordError } from '@lib/errorFingerprint';
import { LIFECYCLE_KINDS } from '@app/models';
import { isSuppressed } from '@app/services/email/suppression';
import { mayReallySend } from '@app/services/email/lifecycleGate';
import { unsubscribeUrls } from '@app/services/email/unsubscribe';
import { recordEmailBlocked, recordEmailDeliveryError, recordEmailSent } from '@app/services/email/metrics';
import type { EmailKind } from '@app/services/email/metrics';
import { APP_ENVIRONMENT, getAppEnvironment } from '@config/environment';
import { catalogueSize } from '@app/services/stats/catalogueSize';
import { SENDERS, configuredSender, senderForUser } from './senders';
import { captureEmailSent } from '@app/services/analytics/posthog';

const tracer = getTracer();

let transporter: nodemailer.Transporter | null = null;

/** Reset the memoized transport in tests; production keeps one transport, but otherwise the first test mock would
 * affect every later case. */
export function resetTransporterForTests(): void {
  transporter = null;
}

/** Memoize the local letter-opener transport; deployed environments use HTTP and must not acquire a nodemailer
 * transport. */
async function getTransporter(): Promise<nodemailer.Transporter> {
  if (transporter) {
    return transporter;
  }

  const environment = getAppEnvironment(config.ENVIRONMENT);

  if (environment === APP_ENVIRONMENT.LOCAL) {
    transporter = nodemailer.createTransport(createLetterOpenerTransport());

    logger.info(
      { outputDir: LETTER_OPENER_DIR },
      'Email transport configured with letter-opener. Emails open in your browser.',
    );
    return transporter;
  }

  // Outside local there is no nodemailer transport at all any more -- see
  // `deliver`. Reaching here means a caller asked for one where none exists.
  throw new Error('No local mail transport outside development: deployed environments send over the SES API.');
}

/** Local opens mail in a browser; everywhere else it goes over the wire. */
function usesLetterOpener(): boolean {
  return getAppEnvironment(config.ENVIRONMENT) === APP_ENVIRONMENT.LOCAL;
}

/** Choose delivery by environment, not relay configuration: local previews use letter-opener; deployed sends use
 * SES. */
async function deliver(message: OutboundMessage): Promise<string | null> {
  if (!usesLetterOpener()) {
    await sendViaSes(message);
    return null;
  }

  const transport = await getTransporter();
  const info = await transport.sendMail({
    from: `${message.from.name} <${message.from.address}>`,
    replyTo: message.replyTo,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    headers: {
      'X-Nadeshiko-Client-Ref': message.clientReference,
      ...(message.unsubscribeUrl
        ? {
            'List-Unsubscribe': `<${message.unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          }
        : {}),
    },
  });

  return getPreviewUrl(info);
}

/**
 * Email sending options.
 */
interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  /** Carry the message kind through SMTP/provider metadata; otherwise webhook events identify an address but not
   * which mail was sent. */
  kind: EmailKind;
  /** Feedback uses Reply-To for the submitter’s address rather than the team inbox. */
  replyTo?: string;
  /** Set unsubscribe headers only for lifecycle mail; omit both when absent so a provider cannot offer a button that
   * fails. */
  unsubscribeUrl?: string;
  /** Keep campaign in the client reference, not the bounded metric label, or recurring campaigns create unbounded
   * series. */
  campaign?: string;
  /** Reader id is metadata only; envelope identity comes from the message kind. */
  userId?: number;
}

function isLifecycleKind(kind: EmailKind): boolean {
  return (LIFECYCLE_KINDS as readonly string[]).includes(kind);
}

/** Choose `From` by message kind here, not at each sender, so suppression and sender policy cannot drift. */
function senderFor(kind: EmailKind): { email: string; name: string } {
  // Use one product envelope identity while `senderForUser` supplies the personal body; replies therefore land in the
  // shared mailbox.

  // Welcome is a sender exception, not a lifecycle kind, so the lifecycle preference switch cannot accidentally disable
  // it.
  if (isLifecycleKind(kind) || kind === 'welcome') {
    return configuredSender();
  }

  return { email: config.MAIL_FROM_EMAIL, name: config.MAIL_FROM_NAME };
}

/** Enforce suppression here, the common synchronous send path; new mailers must route through it rather than reach
 * for transport directly. */
export async function sendEmail(options: EmailOptions): Promise<void> {
  const { email: fromEmail, name: fromName } = senderFor(options.kind);

  // Enforce the lifecycle switch again at send time; callers other than the sweep must not send while the feature is
  // disabled.
  if (isLifecycleKind(options.kind) && !mayReallySend(options.to)) {
    logger.info({ 'email.kind': options.kind }, 'Not sending: lifecycle email is not live for this recipient');
    return;
  }

  // Return rather than throw for a known-bad welcome address, or worker retries turn a delivery policy into a failed
  // job.
  if (await isSuppressed(options.to)) {
    recordEmailBlocked();
    logger.info({ 'email.kind': options.kind }, 'Not sending: the recipient is suppressed');
    return;
  }

  return tracer.startActiveSpan(`email.send ${options.kind}`, async (span) => {
    span.setAttribute('email.kind', options.kind);
    span.setAttribute('messaging.system', usesLetterOpener() ? 'letter-opener' : 'aws-ses');

    try {
      // Derive plaintext centrally so every email has an accessible, deliverable alternative without a second copy of
      // its words.
      const text = htmlToPlainText(options.html);
      const clientReference = options.campaign ? `${options.kind}:${options.campaign}` : options.kind;

      const previewUrl = await deliver({
        from: { address: fromEmail, name: fromName },
        to: options.to,
        subject: options.subject,
        html: options.html,
        text,
        replyTo: options.replyTo,
        clientReference,
        unsubscribeUrl: options.unsubscribeUrl,
      });

      recordEmailSent(options.kind);

      if (previewUrl) {
        logger.info({ 'email.kind': options.kind, previewUrl }, 'Email opened in your browser');
        return;
      }

      logger.info({ 'email.kind': options.kind }, 'Email sent');
    } catch (error) {
      // Count relay rejection separately from recipient bounce; the former is our outage, not a verdict on the address.
      recordEmailDeliveryError(error instanceof Error ? error.name : 'UnknownError');
      recordError(error instanceof Error ? error : new Error(String(error)), 'email:send', {
        'email.kind': options.kind,
      });
      logger.error({ err: error, 'email.kind': options.kind }, 'Failed to send email');
      throw error;
    } finally {
      span.end();
    }
  });
}

/** Enqueue a per-user welcome message.
 * @param userId - Deduplication identity
 * @param username - Greeting name
 * @param email - Recipient address */
export async function sendWelcomeEmail(userId: number, username: string, email: string): Promise<void> {
  // Read the sender identity here so template builders remain pure and database failure stays on the soft-failing
  // caller path.
  const { subject, html } = await buildWelcomeEmail(username, senderForUser(userId), await catalogueSize());

  await sendEmailJob(
    {
      to: email,
      subject,
      html,
      kind: 'welcome',
      userId,
    },
    `welcome-${userId}`, // Dedupe key to prevent duplicate welcome emails
  );

  captureEmailSent({ userId, kind: 'welcome', campaign: 'welcome' });
}

export async function sendMagicLinkEmail(email: string, url: string, code?: string | null): Promise<void> {
  const { subject, html } = await buildMagicLinkEmail(url, code);
  await sendEmail({ to: email, subject, html, kind: 'magic-link' });
}

export async function sendVerifyNewEmail(email: string, verificationUrl: string): Promise<void> {
  const { subject, html } = await buildVerifyNewEmailEmail(verificationUrl);
  await sendEmail({ to: email, subject, html, kind: 'verify-new-email' });
}

/** Queue feedback notification after storing the row; relay outage must not fail a submission already persisted. */
export async function sendFeedbackEmail(
  input: FeedbackEmailInput & { replyTo?: string; feedbackId: number },
): Promise<void> {
  const to = config.FEEDBACK_NOTIFICATION_TO;
  if (!to) {
    logger.info({ feedbackId: input.feedbackId }, 'FEEDBACK_NOTIFICATION_TO unset, skipping feedback notification');
    return;
  }

  const { subject, html } = await buildFeedbackEmail(input);

  await sendEmailJob(
    { to, subject, html, replyTo: input.replyTo, kind: 'feedback' },
    // One notification per row. A pg-boss retry that re-runs the enqueue must not
    // put a second copy of the same message in the inbox.
    `feedback-${input.feedbackId}`,
  );
}

/** Return the selected campaign from the builder so the claim row and provider reference describe the same opening. */
export async function sendFeedbackAskEmail(input: {
  userId: number;
  username: string;
  email: string;
  started: boolean;
}): Promise<string> {
  const { oneClick, page } = unsubscribeUrls(input.userId, 'checkins');
  const { subject, html, campaign } = await buildFeedbackAskEmail({
    username: input.username,
    sender: senderForUser(input.userId),
    started: input.started,
    unsubscribeUrl: page,
  });

  await sendEmailJob(
    {
      to: input.email,
      subject,
      html,
      kind: 'feedback-ask',
      campaign,
      userId: input.userId,
      unsubscribeUrl: oneClick,
      // Leave `replyTo` unset: directing a personal answer to the team alias would copy it into Discord.
    },
    `feedback-ask-${input.userId}`,
  );

  captureEmailSent({ userId: input.userId, kind: 'feedback-ask', campaign });

  return campaign;
}

/** Include the month in `dormant-30` campaign and dedupe key because dormancy can recur after the reader returns. */
export async function sendDormant30Email(input: {
  userId: number;
  username: string;
  email: string;
  campaign: string;
  newTitles: number;
  titles: DormantTitle[];
}): Promise<void> {
  const { oneClick, page } = unsubscribeUrls(input.userId, 'checkins');
  const { subject, html } = await buildDormant30Email({
    userId: input.userId,
    campaign: input.campaign,
    username: input.username,
    sender: senderForUser(input.userId),
    newTitles: input.newTitles,
    titles: input.titles,
    unsubscribeUrl: page,
  });

  await sendEmailJob(
    {
      to: input.email,
      subject,
      html,
      kind: 'dormant-30',
      campaign: input.campaign,
      userId: input.userId,
      unsubscribeUrl: oneClick,
      // Keep lifecycle replies off the chat-bridged team alias; leave `replyTo` unset to follow the configured From.
    },
    `${input.campaign}-${input.userId}`,
  );

  captureEmailSent({ userId: input.userId, kind: 'dormant-30', campaign: input.campaign });
}

export const TEST_EMAIL_TEMPLATES = [
  'welcome',
  'verify-new-email',
  'magic-link',
  'feedback',
  'feedback-ask-started',
  'feedback-ask-cold',
  'dormant-30',
  'dormant-30-quiet',
] as const;

export type TestEmailTemplate = (typeof TEST_EMAIL_TEMPLATES)[number];

/** List preview names explicitly so the compiler checks every non-kind opening maps to a real `EmailKind`. */
function kindOfTestTemplate(template: TestEmailTemplate): EmailKind {
  switch (template) {
    case 'feedback-ask-started':
    case 'feedback-ask-cold':
      return 'feedback-ask';
    case 'dormant-30-quiet':
      return 'dormant-30';
    default:
      return template;
  }
}

/** Preview deliberately bypasses `sendEmail`, suppression, and sent metrics; local template inspection must not
 * alter production accounting. */
export async function sendTestEmail(template: TestEmailTemplate, to: string): Promise<{ previewUrl: string | null }> {
  const username = 'TestUser';

  let subject: string;
  let html: string;

  if (template === 'welcome') {
    ({ subject, html } = await buildWelcomeEmail(username, SENDERS[0]));
  } else if (template === 'verify-new-email') {
    ({ subject, html } = await buildVerifyNewEmailEmail('https://nadeshiko.co/v1/auth/verify-email?token=test-token'));
  } else if (template === 'feedback') {
    ({ subject, html } = await buildFeedbackEmail({
      from: 'reader@example.com',
      message: 'The player stops after the first segment on Firefox.\n\nHappens every time on /search.',
      context: [
        'Feedback: #123',
        'Account: anonymous',
        'Page: /search?q=彼女',
        'Locale: ja',
        'Country: JP',
        'Version: 2.4.0',
        'User agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      ].join('\n'),
    }));
  } else if (template === 'feedback-ask-started' || template === 'feedback-ask-cold') {
    ({ subject, html } = await buildFeedbackAskEmail({
      username,
      sender: SENDERS[0],
      started: template === 'feedback-ask-started',
      unsubscribeUrl: unsubscribeUrls(1).page,
    }));
  } else if (template === 'dormant-30' || template === 'dormant-30-quiet') {
    // Preview both feedback openings; they are distinct copy paths even though they share one message kind.
    ({ subject, html } = await buildDormant30Email({
      userId: 1,
      // A literal rather than `dormantCampaign()`: this is a preview, and
      // importing it would point the mailer back at the worker that calls it.
      campaign: 'dormant-30-preview',
      username,
      sender: SENDERS[0],
      newTitles: template === 'dormant-30' ? 57 : 0,
      titles:
        template === 'dormant-30'
          ? [
              {
                name: 'Frieren: Beyond Journey\u2019s End',
                coverUrl: `${config.BASE_URL}/logo-38d6e06a.webp`,
                path: '/media/frieren',
              },
              {
                name: 'Violet Evergarden',
                coverUrl: `${config.BASE_URL}/logo-38d6e06a.webp`,
                path: '/media/violet-evergarden',
              },
              {
                name: 'Kaguya-sama: Love Is War',
                coverUrl: `${config.BASE_URL}/logo-38d6e06a.webp`,
                path: '/media/kaguya-sama',
              },
            ]
          : [],
      unsubscribeUrl: unsubscribeUrls(1).page,
    }));
  } else {
    ({ subject, html } = await buildMagicLinkEmail(`${config.BASE_URL}/v1/auth/magic-link/verify?token=test-token`));
  }

  // Use `senderFor` so previews show the same From identity as real sends.
  const { email: fromEmail, name: fromName } = senderFor(kindOfTestTemplate(template));

  // Use `deliver` so previews exercise the environment’s real transport rather than a divergent code path.
  const previewUrl = await deliver({
    from: { address: fromEmail, name: fromName },
    to,
    subject,
    html,
    text: htmlToPlainText(html),
    clientReference: template,
  });
  if (previewUrl) {
    logger.info({ to, subject, previewUrl }, 'Test email opened in your browser');
  } else {
    logger.info({ to, subject }, 'Test email sent');
  }

  return { previewUrl };
}
