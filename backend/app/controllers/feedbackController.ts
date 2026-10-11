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

/** Anonymous feedback uses honeypot, issue-time token, and per-IP signals; bot signals store nothing, while
 * user-fixable errors return 400. */

/** Faster than this is not someone reading a form and typing into it. */
const MIN_FILL_MS = 2_000;

/** The token lasts long enough for a person to compose feedback, but not forever if it is scraped. */
const FORM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const MAX_USER_AGENT = 500;
const MAX_PAGE_PATH = 2000;

interface FormToken {
  issuedAt: number;
}

/** Reuse the required session-signing secret; an optional separate secret could be unset and silently disable the
 * public widget. */
/** Derive a purpose-specific HMAC key from `BETTER_AUTH_SECRET`, so feedback tokens cannot be reused as
 * auth-protected values. */
const FORM_TOKEN_CONTEXT = { purpose: 'feedback.form-token' } as const;

function formTokenSecret(): string {
  return config.BETTER_AUTH_SECRET;
}

export const getFeedbackFormToken: GetFeedbackFormToken = async (_params, respond) => {
  const token = encryptSecret(
    JSON.stringify({ issuedAt: Date.now() } satisfies FormToken),
    formTokenSecret(),
    FORM_TOKEN_CONTEXT,
  );
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
      // For signed-in feedback, use the account’s address rather than form input so the reply target cannot be
      // attacker-chosen.
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

  // Store feedback first and queue notification after; mail failure must not turn a persisted submission into a failed
  // request.
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

/** Return a reason, not a boolean, so telemetry can distinguish which automation signal fired. */
function automatedReason(nickname: string | undefined, formToken: string): string | null {
  if (nickname?.trim()) return 'honeypot';

  let token: FormToken;
  try {
    token = JSON.parse(decryptSecret(formToken, formTokenSecret(), FORM_TOKEN_CONTEXT)) as FormToken;
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

/** Too many links is a visible 400 because a person can fix it; do not silently drop a legitimate message for this
 * signal. */
function assertWithinLinkBudget(message: string): void {
  const links = message.match(/https?:\/\//gi)?.length ?? 0;
  if (links > FEEDBACK_MAX_URLS) {
    throw new InvalidRequestError(`Feedback can contain at most ${FEEDBACK_MAX_URLS} links.`);
  }
}

/** The public route treats session-resolution failures as anonymous, so a stale cookie does not reject an otherwise
 * valid feedback submission. */
async function resolveSender(
  req: Request,
): Promise<{ userId: number | null; email: string | null; name: string | null }> {
  const anonymous = { userId: null, email: null, name: null };

  try {
    // Use `disableRefresh`: this route needs identity only and cannot return a renewed cookie.
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
      query: { disableRefresh: true },
    });
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

/** Accept same-origin paths only; reject `//host` too, because protocol-relative destinations bypass naive prefix
 * checks. */
function sanitizePagePath(value: string | undefined): string | null {
  const path = value?.trim();
  if (!path?.startsWith('/') || path.startsWith('//')) return null;
  return path.slice(0, MAX_PAGE_PATH);
}

function normalizeEmail(value: string | undefined): string | null {
  return value?.trim().toLowerCase() || null;
}

/** Use the first Accept-Language entry as a locale fallback; omit `*` rather than storing it as a language. */
function headerLocale(req: Request): string | null {
  const primary = req.get('accept-language')?.split(',')[0]?.trim().slice(0, 16);
  return primary && primary !== '*' ? primary : null;
}

function fromLabel(feedback: Feedback, name: string | null): string {
  if (feedback.userId)
    return name ? `${name} <${feedback.email ?? 'no email'}>` : (feedback.email ?? `#${feedback.userId}`);
  return feedback.email ?? 'Anonymous';
}

/** Do not put the sender IP in context: feedback mail is copied to a Discord log, while the table remains the place
 * for abuse investigation. */
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
