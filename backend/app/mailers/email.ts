import nodemailer from 'nodemailer';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { config } from '@config/config';
import { logger } from '@config/log';
import {
  buildWelcomeEmail,
  buildAnnouncementEmail,
  buildVerifyNewEmailEmail,
  buildMagicLinkEmail,
} from './emailTemplates';
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
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });

    logger.info('Email transport configured with Ethereal. Preview URLs will be logged.');
    return transporter;
  }

  const region = config.SES_AWS_REGION;
  const accessKeyId = config.SES_AWS_ACCESS_KEY_ID;
  const secretAccessKey = config.SES_AWS_SECRET_ACCESS_KEY;

  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'SES configuration is required in dev/prod. Set SES_AWS_REGION, SES_AWS_ACCESS_KEY_ID, and SES_AWS_SECRET_ACCESS_KEY.',
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
export interface EmailOptions {
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

    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      logger.info(
        {
          to: options.to,
          subject: options.subject,
          previewUrl: previewUrl.toString(),
        },
        'Email sent (preview URL available)',
      );
      return;
    }

    logger.info(`Email sent to ${options.to}: ${options.subject}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to send email to ${options.to}: ${errorMessage}`);
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

/**
 * Sends an announcement email to a user.
 * Used for terms/conditions updates, API SDK changes, or admin communications.
 *
 * @param userId - User ID for deduplication
 * @param username - Username of the recipient
 * @param email - Email address of the recipient
 * @param subject - Subject of the announcement
 * @param message - Message body (can contain HTML)
 */
export async function sendAnnouncementEmail(
  userId: number,
  username: string,
  email: string,
  subject: string,
  message: string,
): Promise<void> {
  const { subject: emailSubject, html } = await buildAnnouncementEmail(username, subject, message);

  await sendEmailJob(
    {
      to: email,
      subject: emailSubject,
      html,
    },
    `announcement-${userId}-${subject.replace(/\s+/g, '-').toLowerCase()}`, // Dedupe key per user and announcement
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

export type TestEmailTemplate = 'welcome' | 'announcement' | 'verify-new-email' | 'magic-link';

/**
 * Sends a test email synchronously (bypassing the queue) and returns the Ethereal preview URL.
 * Intended for local development only.
 */
export async function sendTestEmail(template: TestEmailTemplate, to: string): Promise<{ previewUrl: string | null }> {
  const username = 'TestUser';

  let subject: string;
  let html: string;

  if (template === 'welcome') {
    ({ subject, html } = await buildWelcomeEmail(username));
  } else if (template === 'verify-new-email') {
    ({ subject, html } = await buildVerifyNewEmailEmail('https://nadeshiko.co/verify?token=test-token'));
  } else if (template === 'magic-link') {
    ({ subject, html } = await buildMagicLinkEmail(`${config.BASE_URL}/v1/auth/magic-link/verify?token=test-token`));
  } else {
    ({ subject, html } = await buildAnnouncementEmail(
      username,
      'Test Announcement',
      'This is a test announcement email.',
    ));
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

  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) {
    logger.info({ to, subject, previewUrl: previewUrl.toString() }, 'Test email sent (preview URL available)');
  } else {
    logger.info({ to, subject }, 'Test email sent via SES');
  }

  return { previewUrl: previewUrl ? previewUrl.toString() : null };
}
