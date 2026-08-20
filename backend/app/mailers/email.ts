import nodemailer from 'nodemailer';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { config } from '@config/config';
import { logger } from '@config/log';
import {
  buildWelcomeEmail,
  buildVerifyNewEmailEmail,
  buildMagicLinkEmail,
  buildFeedbackEmail,
  type FeedbackEmailInput,
} from './emailTemplates';
import { createLetterOpenerTransport, getPreviewUrl, LETTER_OPENER_DIR } from './letterOpener';
import { sendEmailJob } from '@app/workers/emailQueue';
import { getTracer } from '@config/telemetry';
import { recordError } from '@lib/errorFingerprint';
import { isSuppressed } from '@app/services/email/suppression';
import { recordEmailBlocked, recordEmailDeliveryError, recordEmailSent } from '@app/services/email/metrics';
import type { EmailKind } from '@app/services/email/metrics';
import { APP_ENVIRONMENT, getAppEnvironment } from '@config/environment';

const tracer = getTracer();

let transporter: nodemailer.Transporter | null = null;

/**
 * Test seam. The transport is memoised for the life of the process, which is
 * right in production and wrong across test cases: the first file to send an
 * email would otherwise pin every later one to its own mock.
 */
export function resetTransporterForTests(): void {
  transporter = null;
}

/**
 * Lazily creates and returns a nodemailer transport configured for the appropriate environment.
 */
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

  if (config.MAIL_TRANSPORT === 'zepto') {
    const host = config.SMTP_ADDRESS ?? 'smtp.zeptomail.jp';
    const port = config.SMTP_PORT ? Number(config.SMTP_PORT) : 587;
    const user = config.SMTP_USER_NAME ?? 'emailapikey';
    const pass = config.SMTP_PASSWORD;

    if (!pass) {
      throw new Error('MAIL_TRANSPORT=zepto requires SMTP_PASSWORD (the ZeptoMail Send Mail Token).');
    }

    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      requireTLS: port === 587,
      auth: { user, pass },
    });

    logger.info({ environment, host, port }, 'Email transport configured with ZeptoMail SMTP');
    return transporter;
  }

  const region = config.SES_AWS_REGION;
  const accessKeyId = config.SES_AWS_ACCESS_KEY_ID;
  const secretAccessKey = config.SES_AWS_SECRET_ACCESS_KEY;

  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'SES configuration is required in development/production. Set SES_AWS_REGION, SES_AWS_ACCESS_KEY_ID, and SES_AWS_SECRET_ACCESS_KEY.',
    );
  }

  const sesClient = new SESv2Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  transporter = nodemailer.createTransport({
    SES: { sesClient, SendEmailCommand },
  });

  logger.info({ environment }, 'Email transport configured with Amazon SES');
  return transporter;
}

/**
 * Email sending options.
 */
interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  /**
   * Which message this is. Rides out as `X-TM-CLIENT-REF` and comes back on
   * every bounce, complaint, and open as `client_reference`.
   *
   * Over SMTP it is the ONLY attribution we get: the webhook names an address,
   * and without this nothing says which mail we sent it or why. It is also the
   * `email.kind` metric label, which is what turns "our bounce rate is up" into
   * "people are typo-ing addresses at the signup form".
   */
  kind: EmailKind;
  /**
   * Who a reply goes to, when that is not us.
   *
   * Only the feedback notification sets it: those land in the team inbox but are
   * written by the person who sent them, so answering has to be a plain reply
   * rather than a copy-paste of an address out of the body. Everything else we
   * send is transactional and replying to it should reach nobody.
   */
  replyTo?: string;
}

/**
 * Sends an email directly (synchronous, for use by workers).
 *
 * THIS IS THE ENFORCEMENT POINT for the suppression list, and it works because
 * every path funnels through here: `sendMagicLinkEmail` and `sendVerifyNewEmail`
 * call it inline, and the queued welcome and feedback mails reach it through
 * `emailWorker`. A check in each sender would be only as good as the discipline
 * of whoever writes the next one. If you add a fifth mailer, route it through
 * this function rather than reaching for the transport yourself.
 */
export async function sendEmail(options: EmailOptions): Promise<void> {
  const fromEmail = config.SES_FROM_EMAIL;
  const fromName = config.SES_FROM_NAME;

  // RETURN RATHER THAN THROW. The caller asked to send a welcome email, not to
  // handle a delivery policy, and throwing would turn a known-bad address into a
  // pg-boss job that fails its five retries and then needs clearing by hand.
  if (await isSuppressed(options.to)) {
    recordEmailBlocked();
    logger.info({ 'email.kind': options.kind }, 'Not sending: the recipient is suppressed');
    return;
  }

  return tracer.startActiveSpan(`email.send ${options.kind}`, async (span) => {
    span.setAttribute('email.kind', options.kind);
    span.setAttribute('messaging.system', 'smtp');

    try {
      const transport = await getTransporter();

      const info = await transport.sendMail({
        from: `${fromName} <${fromEmail}>`,
        replyTo: options.replyTo,
        to: options.to,
        subject: options.subject,
        html: options.html,
        headers: { 'X-TM-CLIENT-REF': options.kind },
      });

      recordEmailSent(options.kind);

      const previewUrl = getPreviewUrl(info);
      if (previewUrl) {
        logger.info({ 'email.kind': options.kind, previewUrl }, 'Email opened in your browser');
        return;
      }

      logger.info({ 'email.kind': options.kind }, 'Email sent');
    } catch (error) {
      // The relay refusing us AT HANDOFF, which is a different incident from a
      // recipient bouncing: it is about us and it hits everybody equally. Counted
      // apart, and deliberately never treated as a verdict on this address.
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

/**
 * Sends a welcome email to a newly registered user.
 * Uses deduplication key to prevent duplicate emails from worker retries.
 *
 * @param userId - User ID for deduplication
 * @param username - Username of the new user
 * @param email - Email address of the new user
 */
export async function sendWelcomeEmail(userId: number, username: string, email: string): Promise<void> {
  const { subject, html } = await buildWelcomeEmail(username);

  await sendEmailJob(
    {
      to: email,
      subject,
      html,
      kind: 'welcome',
    },
    `welcome-${userId}`, // Dedupe key to prevent duplicate welcome emails
  );
}

export async function sendMagicLinkEmail(email: string, url: string): Promise<void> {
  const { subject, html } = await buildMagicLinkEmail(url);
  await sendEmail({ to: email, subject, html, kind: 'magic-link' });
}

export async function sendVerifyNewEmail(email: string, verificationUrl: string): Promise<void> {
  const { subject, html } = await buildVerifyNewEmailEmail(verificationUrl);
  await sendEmail({ to: email, subject, html, kind: 'verify-new-email' });
}

/**
 * Notifies the team that someone sent feedback.
 *
 * WHERE THIS ACTUALLY LANDS: if `FEEDBACK_NOTIFICATION_TO` is an address at
 * `nadeshiko.co`, the message comes straight back in through Cloudflare Email
 * Routing, whose catch-all hands every message to a worker that forwards it to
 * the maintainers AND posts the complete body into a Discord channel
 * (brigadasos-infra/email-worker). That is useful — feedback shows up where
 * people already are — but it means the body is chat-log material, not inbox
 * material. `contextLines` in feedbackController is written for that audience.
 *
 * Queued rather than sent inline: the sender is waiting on the HTTP response and
 * has no stake in whether SES was reachable, so a mail outage must not turn into
 * a failed submission for a message we have already stored.
 *
 * No-ops when `FEEDBACK_NOTIFICATION_TO` is unset, which is the state local and
 * test runs are in. Logged at info, not warn: it is a configuration choice, not
 * a fault, and the row is in the table either way.
 */
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

export type TestEmailTemplate = 'welcome' | 'verify-new-email' | 'magic-link' | 'feedback';

/**
 * Sends a test email synchronously (bypassing the queue) and returns the preview
 * URL of the file letter-opener wrote. Intended for local development only.
 */
export async function sendTestEmail(template: TestEmailTemplate, to: string): Promise<{ previewUrl: string | null }> {
  const username = 'TestUser';

  let subject: string;
  let html: string;

  if (template === 'welcome') {
    ({ subject, html } = await buildWelcomeEmail(username));
  } else if (template === 'verify-new-email') {
    ({ subject, html } = await buildVerifyNewEmailEmail('https://nadeshiko.co/verify?token=test-token'));
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
  } else {
    ({ subject, html } = await buildMagicLinkEmail(`${config.BASE_URL}/v1/auth/magic-link/verify?token=test-token`));
  }

  const fromEmail = config.SES_FROM_EMAIL;
  const fromName = config.SES_FROM_NAME;
  const transport = await getTransporter();

  const info = await transport.sendMail({
    from: `${fromName} <${fromEmail}>`,
    to,
    subject,
    html,
    headers: { 'X-TM-CLIENT-REF': template },
  });

  const previewUrl = getPreviewUrl(info);
  if (previewUrl) {
    logger.info({ to, subject, previewUrl }, 'Test email opened in your browser');
  } else {
    logger.info({ to, subject }, 'Test email sent');
  }

  return { previewUrl };
}
