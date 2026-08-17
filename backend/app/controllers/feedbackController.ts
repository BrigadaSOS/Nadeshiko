import type { Request } from 'express';
import type { CreateFeedback, GetFeedbackFormToken } from 'generated/routes/feedback';
import { fromNodeHeaders } from 'better-auth/node';
import { Feedback, FEEDBACK_MAX_URLS } from '@app/models';
import { InvalidRequestError } from '@app/errors';
import { auth } from '@config/auth';
import { config } from '@config/config';
import { logger } from '@config/log';
import { sendFeedbackEmail } from '@app/mailers/email';
import { encryptSecret, decryptSecret } from '@lib/secretBox';
import { resolveClientIp } from '@app/middleware/rateLimit';

/**
 * The feedback widget.
 *
 * Open to anonymous visitors, which makes it the only unauthenticated write in
 * the API and so the only one that cannot lean on a session for its bot
 * resistance. Three things stand in for that, in increasing order of how much
 * they actually do:
 *
 *   1. a honeypot field, which catches form-fillers and nothing else;
 *   2. an issue-time token, which catches anything submitting faster than a
 *      person could have typed, and anything replaying a request with no token;
 *   3. a per-IP limit, at the Nitro proxy for site traffic and in
 *      `feedbackRateLimit` for direct calls, which is what bounds the rest.
 *
 * The first two answer `201` and store nothing rather than rejecting, so a bot
 * cannot use the response to learn which of its details gave it away. That is
 * only safe for signals a person cannot trip by accident -- an honest sender is
 * never silently dropped. Anything a person CAN get wrong (an over-long message,
 * a wall of links) is a real `400` with a real message, because they can fix it.
 */

/** Faster than this is not someone reading a form and typing into it. */
const MIN_FILL_MS = 2_000;

/**
 * Generous on purpose. The token is issued when the panel opens, and the whole
 * point of a feedback box is that people compose in it -- a bug report written
 * carefully over lunch must not be the one submission we throw away. Long enough
 * for that, short enough that a token scraped once is not a permanent key.
 */
const FORM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const MAX_USER_AGENT = 500;
const MAX_PAGE_PATH = 2000;

interface FormToken {
  issuedAt: number;
}

/**
 * The same key better-auth signs sessions with. Reused rather than added to the
 * config because it is already required in every environment: a separate
 * optional secret would be unset somewhere, and "unset" for this one has to mean
 * "no token is ever valid", which would turn the widget off in exactly the
 * environment nobody checked.
 */
function formTokenSecret(): string {
  return config.BETTER_AUTH_SECRET;
}

export const getFeedbackFormToken: GetFeedbackFormToken = async (_params, respond) => {
  const token = encryptSecret(JSON.stringify({ issuedAt: Date.now() } satisfies FormToken), formTokenSecret());
  return respond.with200().body({ token });
};

export const createFeedback: CreateFeedback = async ({ body }, respond, req) => {
  const message = body.body.trim();
  if (!message) {
    throw new InvalidRequestError('Feedback message cannot be empty.');
  }
  assertWithinLinkBudget(message);

  // Bots fill the honeypot or submit instantly. Answer as if it worked.
  const automated = automatedReason(body.nickname, body.formToken);
  if (automated) {
    logger.info({ reason: automated, path: sanitizePagePath(body.pagePath) }, 'Dropped automated feedback submission');
    return respond.with201().body({ received: true });
  }

  const sender = await resolveSender(req);

  const feedback = await Feedback.save(
    Feedback.create({
      body: message,
      // A signed-in sender's own address wins over anything typed in the form:
      // otherwise the reply-to on the notification is attacker-chosen while the
      // message is attributed to a real account.
      email: sender.email ?? normalizeEmail(body.email),
      userId: sender.userId,
      pagePath: sanitizePagePath(body.pagePath),
      locale: body.locale?.trim().slice(0, 16) || headerLocale(req),
      country: req.get('cf-ipcountry')?.trim().toUpperCase() || null,
      userAgent: req.get('user-agent')?.slice(0, MAX_USER_AGENT) || null,
      ipAddress: resolveClientIp(req) || null,
      appVersion: body.appVersion?.trim() || null,
      posthogSessionId: body.posthogSessionId?.trim() || null,
      posthogDistinctId: body.posthogDistinctId?.trim() || null,
    }),
  );

  // The row is what we promised to keep; the email is a convenience on top of
  // it. A mail outage must not turn a stored message into a failed submission,
  // so the notification is queued and its failure is logged, not raised.
  try {
    await sendFeedbackEmail({
      feedbackId: feedback.id,
      from: fromLabel(feedback, sender.name),
      message: feedback.body,
      context: contextLines(feedback, req),
      replyTo: feedback.email ?? undefined,
    });
  } catch (error) {
    logger.error({ err: error, feedbackId: feedback.id }, 'Failed to queue feedback notification');
  }

  return respond.with201().body({ received: true });
};

/**
 * Why this submission looks automated, or null if it does not.
 *
 * Returns a reason rather than a boolean so the log can say which signal fired:
 * a spike in `too-fast` and a spike in `honeypot` are different problems, and a
 * spike in `too-fast` with no matching drop in stored feedback is the shape of
 * MIN_FILL_MS being set too high for real people.
 */
function automatedReason(nickname: string | undefined, formToken: string): string | null {
  if (nickname?.trim()) return 'honeypot';

  let token: FormToken;
  try {
    token = JSON.parse(decryptSecret(formToken, formTokenSecret())) as FormToken;
  } catch {
    // Forged, corrupt, or sealed under a rotated secret. Indistinguishable here,
    // and all three mean the form this came from is not one we served.
    return 'bad-token';
  }

  if (!Number.isFinite(token?.issuedAt)) return 'bad-token';

  const age = Date.now() - token.issuedAt;
  // A negative age is a clock skew or a hand-made token; either way it is not a
  // form we issued being filled in.
  if (age < MIN_FILL_MS) return 'too-fast';
  if (age > FORM_TOKEN_TTL_MS) return 'expired-token';

  return null;
}

/**
 * A message is allowed to cite a page or two. Six URLs is link spam, and it is
 * the one bot signal a person could plausibly trip, so it is a visible error
 * rather than a silent drop.
 */
function assertWithinLinkBudget(message: string): void {
  const links = message.match(/https?:\/\//gi)?.length ?? 0;
  if (links > FEEDBACK_MAX_URLS) {
    throw new InvalidRequestError(`Feedback can contain at most ${FEEDBACK_MAX_URLS} links.`);
  }
}

/**
 * The account behind the request, when there is one.
 *
 * The route carries no auth middleware -- it is public -- so `req.user` is never
 * populated and the session has to be resolved here. Every failure resolves to
 * "anonymous": a stale cookie must degrade to an unattributed message, not to a
 * refused one.
 */
async function resolveSender(
  req: Request,
): Promise<{ userId: number | null; email: string | null; name: string | null }> {
  const anonymous = { userId: null, email: null, name: null };

  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const userId = Number(session?.user?.id);
    if (!Number.isInteger(userId) || userId <= 0) return anonymous;

    return {
      userId,
      email: session?.user?.email?.trim() || null,
      name: session?.user?.name?.trim() || null,
    };
  } catch (error) {
    logger.warn({ err: error }, 'Could not resolve session for feedback; recording it as anonymous');
    return anonymous;
  }
}

/** Same-origin paths only, so a report from `/search?q=…` keeps what they were
 *  looking at and nothing else can be smuggled into the notification email.
 *  `//host` is rejected as well as `http://host`: it is protocol-relative and
 *  reads as a path to anything doing a naive prefix check. */
function sanitizePagePath(value: string | undefined): string | null {
  const path = value?.trim();
  if (!path?.startsWith('/') || path.startsWith('//')) return null;
  return path.slice(0, MAX_PAGE_PATH);
}

function normalizeEmail(value: string | undefined): string | null {
  return value?.trim().toLowerCase() || null;
}

/**
 * Fallback for a client that did not say which locale it was rendering — an API
 * caller, or an older bundle. Only the primary tag: `es-419,es;q=0.9,en;q=0.8`
 * is `es-419` for our purposes, and `*` (which is what a header-less client
 * sends) is dropped rather than stored as a language nobody speaks.
 */
function headerLocale(req: Request): string | null {
  const primary = req.get('accept-language')?.split(',')[0]?.trim().slice(0, 16);
  return primary && primary !== '*' ? primary : null;
}

function fromLabel(feedback: Feedback, name: string | null): string {
  if (feedback.userId)
    return name ? `${name} <${feedback.email ?? 'no email'}>` : (feedback.email ?? `#${feedback.userId}`);
  return feedback.email ?? 'Anonymous';
}

/**
 * The context nobody types: where they were, on what, in which build. One
 * `Key: value` per line, and absent values are omitted rather than printed as
 * blanks, so the block stays short enough to actually read.
 *
 * DELIBERATELY NOT the IP address, even though the row stores one. Inbound mail
 * to `nadeshiko.co` hits a Cloudflare Email Routing catch-all whose worker posts
 * every message body into a Discord channel in full (see
 * brigadasos-infra/email-worker). So anything put here is not "in our inbox", it
 * is in a chat log with its own membership and its own retention. An IP is the
 * one field on this row that identifies a person rather than describing a
 * problem, and there is nothing you would do with it from an inbox anyway --
 * abuse questions are answered against the table, where it still is.
 */
function contextLines(feedback: Feedback, req: Request): string {
  const entries: Array<[string, string | null | undefined]> = [
    ['Feedback', `#${feedback.id}`],
    ['Account', feedback.userId ? `#${feedback.userId}` : 'anonymous'],
    ['Page', feedback.pagePath],
    ['Host', req.get('host')],
    ['Locale', feedback.locale],
    ['Country', feedback.country],
    ['Version', feedback.appVersion],
    ['PostHog session', feedback.posthogSessionId],
    ['User agent', feedback.userAgent],
  ];

  return entries
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}
