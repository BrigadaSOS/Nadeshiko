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
import { sendViaZeptomailApi, type ZeptomailMessage } from './zeptomailSend';
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
import { captureEmailSent } from '@app/services/analytics/posthog';

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

  // Outside local there is no nodemailer transport at all any more -- see
  // `deliver`. Reaching here means a caller asked for one where none exists.
  throw new Error('No local mail transport outside development: deployed environments send over the ZeptoMail API.');
}

/** Local opens mail in a browser; everywhere else it goes over the wire. */
function usesLetterOpener(): boolean {
  return getAppEnvironment(config.ENVIRONMENT) === APP_ENVIRONMENT.LOCAL;
}

/**
 * Hands one message to whichever transport this environment has, and answers
 * with a preview URL when there is one to show.
 *
 * THE SPLIT IS BY ENVIRONMENT, NOT BY CONFIGURATION, and that is the point.
 * `MAIL_TRANSPORT` used to select between two real relays and was deleted
 * because the unselected one rotted; this replaces it with a choice that cannot
 * drift, because the branch nobody is running is the one that opens a file in a
 * browser.
 */
async function deliver(message: ZeptomailMessage): Promise<string | null> {
  if (!usesLetterOpener()) {
    await sendViaZeptomailApi(message);
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
      'X-TM-CLIENT-REF': message.clientReference,
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
  // WELCOME IS THE EXCEPTION, and it is a sender exception rather than a kind
  // one on purpose. It reads as a note from a person -- "Hi! I'm David" -- and
  // invites a reply, so it cannot go out over `noreply@`. But it must not become
  // a lifecycle kind to get that: lifecycle kinds are gated on
  // `LIFECYCLE_EMAILS_ENABLED`, and a welcome email that stops arriving because
  // somebody has not switched the newsletter on is an outage, not a policy.
  if (isLifecycleKind(kind) || kind === 'welcome') {
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
    span.setAttribute('messaging.system', usesLetterOpener() ? 'letter-opener' : 'zeptomail-api');

    try {
      // Derived here rather than per template, so it cannot be the thing
      // somebody forgets on the next mailer. See `htmlToPlainText` for why an
      // HTML-only message costs us reputation on the Agent that carries
      // sign-in.
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
        // Decided here for the same reason the From address is: this is the one
        // place that already knows which side of the transactional line a kind
        // falls on, and a transport that had to work it out for itself would be
        // a second copy of that judgement waiting to disagree.
        lifecycle: isLifecycleKind(options.kind),
      });

      recordEmailSent(options.kind);

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
  // Read here rather than inside the builder, so the template layer stays a pure
  // function of its inputs and the one place that touches the database is the
  // one that already knows how to fail softly.
  const { subject, html } = await buildWelcomeEmail(username, await catalogueSize());

  await sendEmailJob(
    {
      to: email,
      subject,
      html,
      kind: 'welcome',
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
 * The day-7 ask.
 *
 * `campaign` comes back OUT of the builder rather than going in, because the
 * builder is what decides which opening the reader gets and the two have to
 * agree: the `EmailLifecycleSend` row says what we sent and the client
 * reference says what came back, and a mismatch leaves a bounce attributable to
 * nothing. The caller writes its claim row from the value returned here.
 */
export async function sendFeedbackAskEmail(input: {
  userId: number;
  username: string;
  email: string;
  started: boolean;
}): Promise<string> {
  const { oneClick, page } = unsubscribeUrls(input.userId, 'checkins');
  const { subject, html, campaign } = await buildFeedbackAskEmail({
    username: input.username,
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

  captureEmailSent({ userId: input.userId, kind: 'feedback-ask', campaign });

  return campaign;
}

/**
 * The win-back note, once a reader's last session has lapsed.
 *
 * `campaign` carries the month rather than repeating the kind, because unlike
 * the other two this one may legitimately happen to the same account twice --
 * see `EmailLifecycleSend.campaign`. The dedupe key follows it for the same
 * reason: keyed on the kind alone, a second dormancy a year later would be
 * swallowed as a duplicate of the first.
 */
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
    username: input.username,
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
      unsubscribeUrl: oneClick,
      // No `replyTo`, for the reason spelled out on the feedback ask: the From
      // is already a personal mailbox, and "reply and tell me why" has to reach
      // one rather than a role address that posts into a chat channel.
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

/**
 * The real `EmailKind` behind a preview name.
 *
 * The two feedback previews are openings of one message rather than two
 * messages, so they collapse back to the kind the sweep would actually send.
 * Listed rather than prefix-matched so the compiler can narrow: a `startsWith`
 * leaves the opening names in the type and the return stops typechecking, which
 * is the check earning its keep -- add a preview whose name is not a real kind
 * and this is where you find out.
 */
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
  } else if (template === 'feedback-ask-started' || template === 'feedback-ask-cold') {
    ({ subject, html } = await buildFeedbackAskEmail({
      username,
      started: template === 'feedback-ask-started',
      unsubscribeUrl: unsubscribeUrls(1).page,
    }));
  } else if (template === 'dormant-30' || template === 'dormant-30-quiet') {
    // Both shapes are previewable, because they are different emails to write:
    // one leads with what has been added, the other admits there is nothing to
    // report and asks what was missing instead. A preview of only the first
    // hides the copy that is hardest to get right.
    ({ subject, html } = await buildDormant30Email({
      username,
      newTitles: template === 'dormant-30' ? 57 : 0,
      titles:
        template === 'dormant-30'
          ? [
              {
                name: 'Frieren: Beyond Journey\u2019s End',
                coverUrl: `${config.BASE_URL}/logo-38d6e06a.webp`,
                url: `${config.BASE_URL}/media/frieren`,
              },
              {
                name: 'Violet Evergarden',
                coverUrl: `${config.BASE_URL}/logo-38d6e06a.webp`,
                url: `${config.BASE_URL}/media/violet-evergarden`,
              },
              {
                name: 'Kaguya-sama: Love Is War',
                coverUrl: `${config.BASE_URL}/logo-38d6e06a.webp`,
                url: `${config.BASE_URL}/media/kaguya-sama`,
              },
            ]
          : [],
      unsubscribeUrl: unsubscribeUrls(1).page,
    }));
  } else {
    ({ subject, html } = await buildMagicLinkEmail(`${config.BASE_URL}/v1/auth/magic-link/verify?token=test-token`));
  }

  // Through `senderFor` rather than reading the config directly, so a preview
  // shows the From the real send would use. Reading `MAIL_FROM_*` here meant the
  // one place anybody actually LOOKS at these emails was the one place that
  // showed the wrong sender -- and "reply to me" under a `noreply@` header is
  // exactly the mistake a preview exists to catch.
  // Through `senderFor` rather than reading the config directly, so a preview
  // shows the From the real send would use. Reading `MAIL_FROM_*` here meant the
  // one place anybody actually LOOKS at these emails was the one place that
  // showed the wrong sender -- and "reply to me" under a `noreply@` header is
  // exactly the mistake a preview exists to catch.
  const { email: fromEmail, name: fromName } = senderFor(kindOfTestTemplate(template));

  // Through `deliver` like every real send, so a preview exercises the transport
  // this environment actually uses rather than a second code path that could
  // render differently from the thing readers receive.
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
