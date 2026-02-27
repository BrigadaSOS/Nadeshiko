import nodemailer from 'nodemailer';
import { SES } from '@aws-sdk/client-ses';
import { config } from '@config/config';
import { logger } from '@config/log';
import { buildWelcomeEmail, buildAnnouncementEmail } from './emailTemplates';
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
  // In automated test runs, keep transport fully local and deterministic.
  if (environment === APP_ENVIRONMENT.LOCAL) {
    transporter = nodemailer.createTransport({
      jsonTransport: true,
    });
    return transporter;
  }

  // In local/dev, prefer SES when configured, otherwise use Ethereal previews.
  if (environment === APP_ENVIRONMENT.LOCAL || environment === APP_ENVIRONMENT.DEV) {
    const region = config.SES_AWS_REGION;
    const accessKeyId = config.SES_AWS_ACCESS_KEY_ID;
    const secretAccessKey = config.SES_AWS_SECRET_ACCESS_KEY;

    // If SES is configured, use it.
    if (region && accessKeyId && secretAccessKey) {
      const ses = new SES({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });

      transporter = nodemailer.createTransport({
        SES: { ses, aws: { Ses: SES } },
      } as any);

      logger.info({ environment }, 'Email transport configured with Amazon SES');
      return transporter;
    }

    // Otherwise, use Ethereal for email previews.
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

    logger.info({ environment }, 'Email transport configured with Ethereal. Preview URLs will be logged.');
    return transporter;
  }

  // Production - require SES configuration
  const region = config.SES_AWS_REGION;
  const accessKeyId = config.SES_AWS_ACCESS_KEY_ID;
  const secretAccessKey = config.SES_AWS_SECRET_ACCESS_KEY;

  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'SES configuration is required in prod. Set SES_AWS_REGION, SES_AWS_ACCESS_KEY_ID, and SES_AWS_SECRET_ACCESS_KEY.',
    );
  }

  const ses = new SES({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  transporter = nodemailer.createTransport({
    SES: { ses, aws: { Ses: SES } },
  } as any);

  logger.info('Email transport configured with Amazon SES (prod)');
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
  const environment = getAppEnvironment(config.ENVIRONMENT);
  const fromEmail = config.SES_FROM_EMAIL;
  const fromName = config.SES_FROM_NAME;

  if (environment === APP_ENVIRONMENT.LOCAL) {
    logger.info(
      {
        environment,
        to: options.to,
        subject: options.subject,
      },
      'Email sent (test mode - logged only)',
    );
    return;
  }

  try {
    const transport = await getTransporter();

    const info = await transport.sendMail({
      from: `${fromName} <${fromEmail}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });

    // Log preview URL when Ethereal transport is used.
    if (nodemailer.getTestMessageUrl) {
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
    }

    logger.info(`Email sent to ${options.to}: ${options.subject}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to send email to ${options.to}: ${errorMessage}`);
    throw error; // Re-throw for pg-boss retry
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
