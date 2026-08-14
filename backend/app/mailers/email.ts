import nodemailer from 'nodemailer';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { config } from '@config/config';
import { logger } from '@config/log';
import { buildWelcomeEmail, buildVerifyNewEmailEmail, buildMagicLinkEmail } from './emailTemplates';
import { createLetterOpenerTransport, getPreviewUrl, LETTER_OPENER_DIR } from './letterOpener';
import { sendEmailJob } from '@app/workers/emailQueue';
import { APP_ENVIRONMENT, getAppEnvironment } from '@config/environment';

let transporter: nodemailer.Transporter | null = null;

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
}

/**
 * Sends an email directly (synchronous, for use by workers).
 */
export async function sendEmail(options: EmailOptions): Promise<void> {
  const fromEmail = config.SES_FROM_EMAIL;
  const fromName = config.SES_FROM_NAME;

  try {
    const transport = await getTransporter();

    const info = await transport.sendMail({
      from: `${fromName} <${fromEmail}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });

    const previewUrl = getPreviewUrl(info);
    if (previewUrl) {
      logger.info(
        {
          to: options.to,
          subject: options.subject,
          previewUrl,
        },
        'Email opened in your browser',
      );
      return;
    }

    logger.info({ to: options.to, subject: options.subject }, 'Email sent');
  } catch (error) {
    logger.error({ err: error, to: options.to }, 'Failed to send email');
    throw error;
  }
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
    },
    `welcome-${userId}`, // Dedupe key to prevent duplicate welcome emails
  );
}

export async function sendMagicLinkEmail(email: string, url: string): Promise<void> {
  const { subject, html } = await buildMagicLinkEmail(url);
  await sendEmail({ to: email, subject, html });
}

export async function sendVerifyNewEmail(email: string, verificationUrl: string): Promise<void> {
  const { subject, html } = await buildVerifyNewEmailEmail(verificationUrl);
  await sendEmail({ to: email, subject, html });
}

export type TestEmailTemplate = 'welcome' | 'verify-new-email' | 'magic-link';

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
  });

  const previewUrl = getPreviewUrl(info);
  if (previewUrl) {
    logger.info({ to, subject, previewUrl }, 'Test email opened in your browser');
  } else {
    logger.info({ to, subject }, 'Test email sent via SES');
  }

  return { previewUrl };
}
