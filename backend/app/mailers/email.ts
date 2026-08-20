import nodemailer from 'nodemailer';
import { config } from '@config/config';
import { logger } from '@config/log';
import {
  buildWelcomeEmail,
  buildVerifyNewEmailEmail,
  buildMagicLinkEmail,
  buildFeedbackEmail,
  buildOnboardingDay7Email,
  buildFeedbackAskEmail,
  type FeedbackEmailInput,
  type OnboardingSignals,
} from './emailTemplates';
import { createLetterOpenerTransport, getPreviewUrl, LETTER_OPENER_DIR } from './letterOpener';
import { htmlToPlainText } from './plainText';
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
 * Lazily creates and returns a nodemailer transport for the environment.
 *
 * TWO TRANSPORTS, NOT THREE. Local development opens mail in a browser through
 * letter-opener; everything else is ZeptoMail SMTP. The Amazon SES branch that
 * used to sit here is gone: it had been the rollback path for the ZeptoMail
 * cutover, and keeping a second sending identity alive long after the cutover
 * settled meant a second set of DKIM records, a second reputation nobody was
 * watching, and the last static AWS credentials in the repo.
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

  const host = config.SMTP_ADDRESS ?? 'smtp.zeptomail.jp';
  const port = config.SMTP_PORT ? Number(config.SMTP_PORT) : 587;
  const user = config.SMTP_USER_NAME ?? 'emailapikey';
  const pass = config.SMTP_PASSWORD;

  if (!pass) {
    throw new Error('SMTP_PASSWORD is required outside local: it is the ZeptoMail Send Mail Token.');
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
  /**
   * The `List-Unsubscribe` target for lifecycle mail, from `unsubscribeUrls`.
   *
   * Set it on anything a reader could reasonably want less of, and NEVER on
   * transactional mail: offering to unsubscribe from sign-in links invites
   * somebody to lock themselves out of their own account, and Gmail's one-click
   * button would let them do it without a confirmation step.
   *
   * Absent means the two headers are omitted entirely rather than emitted empty
   * -- a `List-Unsubscribe` a provider cannot act on is worse than none, because
   * the button appears and then fails.
   */
  unsubscribeUrl?: string;
  /**
   * Which run of `kind` this is, for lifecycle mail that recurs.
   *
   * Appended to the client reference as `<kind>:<campaign>` and DELIBERATELY NOT
   * added to the metric label. `email.kind` is bounded by construction -- eight
   * values -- and a per-month campaign would grow the series count without
   * limit, quietly breaking every alert rule that divides one email counter by
   * another. The webhook splits this back apart; see `EmailEvent`.
   */
  campaign?: string;
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
/**
 * Who a given message comes from.
 *
 * DECIDED BY KIND, HERE, rather than passed in by each sender -- the same
 * argument the suppression check below is built on. A `from` parameter would be
 * only as reliable as whoever writes the next mailer remembering to set it, and
 * the failure is silent: the mail sends, the template still says "reply to me",
 * and the reply lands in a mailbox nobody opens.
 *
 * Transactional mail keeps `noreply@`, and that is not laziness. A sign-in link
 * is the account working; there is nothing to reply TO, and inviting a reply
 * that will not be read is worse than not inviting one.
 */
function isLifecycleKind(kind: EmailKind): boolean {
  return (LIFECYCLE_KINDS as readonly string[]).includes(kind);
}

function senderFor(kind: EmailKind): { email: string; name: string } {
  if (isLifecycleKind(kind)) {
    return { email: config.LIFECYCLE_FROM_EMAIL, name: config.LIFECYCLE_FROM_NAME };
  }

  return { email: config.MAIL_FROM_EMAIL, name: config.MAIL_FROM_NAME };
}

export async function sendEmail(options: EmailOptions): Promise<void> {
  const { email: fromEmail, name: fromName } = senderFor(options.kind);

  // THE SECOND ENFORCEMENT POINT FOR THE LIFECYCLE SWITCH, and the last one.
  //
  // The sweep already checks this, and has to -- it must not write a claim row
  // for a send it is not making. But the sweep is one caller, and this feature
  // ships disabled precisely so that nothing goes out before somebody has read
  // the copy. A `bin` script, a console session, or the recap when it lands
  // would each reach `sendEmail` without passing the sweep, and any of them
  // sending real mail while the switch says off would make the switch a comment
  // rather than a control. Same argument, same place, as the suppression check
  // immediately below.
  if (isLifecycleKind(options.kind) && !mayReallySend(options.to)) {
    logger.info({ 'email.kind': options.kind }, 'Not sending: lifecycle email is not live for this recipient');
    return;
  }

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
        // Derived here rather than per template, so it cannot be the thing
        // somebody forgets on the next mailer. See `htmlToPlainText` for why an
        // HTML-only message costs us reputation on the Agent that carries
        // sign-in.
        text: htmlToPlainText(options.html),
        headers: {
          'X-TM-CLIENT-REF': options.campaign ? `${options.kind}:${options.campaign}` : options.kind,
          // RFC 8058. Both headers or neither: `List-Unsubscribe-Post` alone is
          // meaningless, and the URI alone gets a provider that opens it in a
          // browser rather than posting to it.
          ...(options.unsubscribeUrl
            ? {
                'List-Unsubscribe': `<${options.unsubscribeUrl}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
              }
            : {}),
        },
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

export async function sendMagicLinkEmail(email: string, url: string, code?: string | null): Promise<void> {
  const { subject, html } = await buildMagicLinkEmail(url, code);
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
 * has no stake in whether the relay was reachable, so a mail outage must not turn into
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

/**
 * The day-7 note and the month-30 feedback ask.
 *
 * Both take the `campaign` rather than deriving it, because the sweep has
 * already written it to `EmailLifecycleSend` and the two must agree: the row
 * says what we sent and the client reference says what came back, and a
 * mismatch would leave a bounce attributable to nothing.
 *
 * The client reference goes out as `<kind>:<campaign>` -- see `sendEmail` for
 * why the campaign cannot become a metric label.
 */
export async function sendOnboardingDay7Email(input: {
  userId: number;
  username: string;
  email: string;
  campaign: string;
  signals: OnboardingSignals;
}): Promise<void> {
  const { oneClick, page } = unsubscribeUrls(input.userId);
  const { subject, html } = await buildOnboardingDay7Email({
    username: input.username,
    signals: input.signals,
    unsubscribeUrl: page,
  });

  await sendEmailJob(
    { to: input.email, subject, html, kind: 'onboarding-day7', campaign: input.campaign, unsubscribeUrl: oneClick },
    `onboarding-day7-${input.userId}`,
  );
}

export async function sendFeedbackAskEmail(input: {
  userId: number;
  username: string;
  email: string;
  campaign: string;
}): Promise<void> {
  const { oneClick, page } = unsubscribeUrls(input.userId);
  const { subject, html } = await buildFeedbackAskEmail({ username: input.username, unsubscribeUrl: page });

  await sendEmailJob(
    {
      to: input.email,
      subject,
      html,
      kind: 'feedback-ask',
      campaign: input.campaign,
      unsubscribeUrl: oneClick,
      // NO `replyTo`. A reply is the point of this email, and `senderFor` has
      // already made the From a real inbox -- so replies go there on their own.
      //
      // Overriding it to `FEEDBACK_NOTIFICATION_TO` would send them somewhere
      // materially different. That is a role address, and role addresses are on
      // the post list of the Zoho -> Discord bridge
      // (lostcoords-infra/email-worker): sender, subject and full body land in a
      // chat channel. `LIFECYCLE_FROM_EMAIL` is a personal mailbox on that
      // bridge's `NEVER_CHAT` list, so an answer to a personal note stays a
      // private reply -- which is what somebody answering "what would you change
      // first?" is entitled to assume.
    },
    `feedback-ask-${input.userId}`,
  );
}

export const TEST_EMAIL_TEMPLATES = [
  'welcome',
  'verify-new-email',
  'magic-link',
  'feedback',
  'onboarding-day7-getting-started',
  'onboarding-day7-anki',
  'onboarding-day7-anki-stalled',
  'onboarding-day7-going-further',
  'feedback-ask',
] as const;

export type TestEmailTemplate = (typeof TEST_EMAIL_TEMPLATES)[number];

/**
 * The real `EmailKind` behind a preview name.
 *
 * The four day-7 previews are variants of one message rather than four
 * messages, so they all collapse back to the kind the sweep would actually send.
 */
function kindOfTestTemplate(template: TestEmailTemplate): EmailKind {
  // Listed rather than prefix-matched so the compiler can narrow: a `startsWith`
  // leaves the variant names in the type and the return stops typechecking,
  // which is the check earning its keep -- add a preview whose name is not a
  // real kind and this is where you find out.
  switch (template) {
    case 'onboarding-day7-getting-started':
    case 'onboarding-day7-anki':
    case 'onboarding-day7-anki-stalled':
    case 'onboarding-day7-going-further':
      return 'onboarding-day7';
    default:
      return template;
  }
}

/**
 * Sends a test email synchronously (bypassing the queue) and returns the preview
 * URL of the file letter-opener wrote. Intended for local development only.
 *
 * DELIBERATELY BYPASSES `sendEmail`, so it is neither counted in `email.sent`
 * nor stopped by the suppression list. Both are right for what this is: a
 * template preview should not move the denominator every rate alert divides by,
 * and someone checking how the welcome mail renders is not writing to the person
 * whose address they borrowed. It still sets X-TM-CLIENT-REF so a message that
 * escapes a local run is identifiable.
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
  } else if (template.startsWith('onboarding-day7')) {
    // The four variants are reached by their signals rather than by name, so a
    // preview exercises the real branch in `pickOnboardingVariant` instead of a
    // parallel switch that could drift from it. `anki` and `anki-stalled` differ
    // only by `hasAnkiProfile`, which is the whole distinction being previewed.
    const signals: OnboardingSignals =
      template === 'onboarding-day7-getting-started'
        ? { activityVisible: true, totalSearches: 0, totalExports: 0, hasAnkiProfile: false }
        : template === 'onboarding-day7-anki'
          ? { activityVisible: true, totalSearches: 12, totalExports: 0, hasAnkiProfile: false }
          : template === 'onboarding-day7-anki-stalled'
            ? { activityVisible: true, totalSearches: 12, totalExports: 0, hasAnkiProfile: true }
            : { activityVisible: true, totalSearches: 12, totalExports: 4, hasAnkiProfile: true };

    ({ subject, html } = await buildOnboardingDay7Email({
      username,
      signals,
      unsubscribeUrl: unsubscribeUrls(1).page,
    }));
  } else if (template === 'feedback-ask') {
    ({ subject, html } = await buildFeedbackAskEmail({ username, unsubscribeUrl: unsubscribeUrls(1).page }));
  } else {
    ({ subject, html } = await buildMagicLinkEmail(`${config.BASE_URL}/v1/auth/magic-link/verify?token=test-token`));
  }

  // Through `senderFor` rather than reading the config directly, so a preview
  // shows the From the real send would use. Reading `MAIL_FROM_*` here meant the
  // one place anybody actually LOOKS at these emails was the one place that
  // showed the wrong sender -- and "reply to me" under a `noreply@` header is
  // exactly the mistake a preview exists to catch.
  const { email: fromEmail, name: fromName } = senderFor(kindOfTestTemplate(template));
  const transport = await getTransporter();

  const info = await transport.sendMail({
    from: `${fromName} <${fromEmail}>`,
    to,
    subject,
    html,
    text: htmlToPlainText(html),
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
