import type {
  GetEmailPreferencesByToken,
  UnsubscribeFromEmail,
  UpdateEmailPreferencesByToken,
} from 'generated/routes/email';
import type { Request, RequestHandler } from 'express';
import { InvalidRequestError } from '@app/errors';
import { logger } from '@config/log';
import { config } from '@config/config';
import { captureEmailLinkClicked } from '@app/services/analytics/posthog';
import {
  classifyHit,
  readReturnToken,
  resolveDestination,
  withAnalyticsSuppressed,
  withCampaignTags,
} from '@app/services/email/returnLink';
import {
  readEmailPreferences,
  readUnsubscribeToken,
  setProductEmailCategory,
  unsubscribeFromProductEmails,
  updateEmailPreferences,
} from '@app/services/email/unsubscribe';

/** Handles browser confirmation and RFC 8058 one-click POSTs idempotently; unreadable tokens are the only 400, while
 * absent accounts still get 2xx. */
export const unsubscribeFromEmail: UnsubscribeFromEmail = async ({ query }, respond) => {
  const intent = readUnsubscribeToken(query.token);

  if (intent === null) {
    // Forged, corrupt, or wrapped by a mail client that broke the URL. The
    // reader can still turn it off in settings, which is what the page says.
    throw new InvalidRequestError('This unsubscribe link is not valid. You can change this in your account settings.');
  }

  // Use the category from the message, not every list; a token without one retains its legacy all-categories meaning.
  const applied = intent.category
    ? await setProductEmailCategory(intent.userId, intent.category, false)
    : await unsubscribeFromProductEmails(intent.userId);

  // Respect opt-out privacy: log endpoint usage without addresses or user ids.
  logger.info({ applied, category: intent.category ?? 'all' }, 'Unsubscribed from product emails');

  return respond.with200().body({ unsubscribed: true });
};

/** GET reads unsubscribe preferences only; mail scanners may fetch links, so the mutation belongs on PATCH. */
export const getEmailPreferencesByToken: GetEmailPreferencesByToken = async ({ query }, respond) => {
  const intent = readUnsubscribeToken(query.token);
  if (intent === null) {
    throw new InvalidRequestError('This unsubscribe link is not valid. You can change this in your account settings.');
  }

  const preferences = await readEmailPreferences(intent.userId);
  if (!preferences) {
    throw new InvalidRequestError('This unsubscribe link is not valid. You can change this in your account settings.');
  }

  return respond.with200().body({ ...preferences, category: intent.category ?? null });
};

/** Apply only submitted switches; a stale page must not overwrite preferences changed elsewhere. */
export const updateEmailPreferencesByToken: UpdateEmailPreferencesByToken = async ({ body }, respond) => {
  const { token, ...patch } = body;
  const intent = readUnsubscribeToken(token);
  if (intent === null) {
    throw new InvalidRequestError('This unsubscribe link is not valid. You can change this in your account settings.');
  }

  const applied = await updateEmailPreferences(intent.userId, patch);
  const preferences = applied ? await readEmailPreferences(intent.userId) : null;

  // Respect opt-out privacy: keep addresses and user ids out of preference-update logs.
  logger.info({ applied, changed: Object.keys(patch) }, 'Email preferences changed from a token');

  if (!preferences) {
    throw new InvalidRequestError('This unsubscribe link is not valid. You can change this in your account settings.');
  }

  return respond.with200().body(preferences);
};

/** Speculative GET/HEAD fetches must be safe; announced hits use the hint, while unannounced crawlers go through
 * `classifyHit`. */
function isMachineFetch(req: Request): boolean {
  if (req.method !== 'GET') return true;

  const header = (name: string): string => String(req.get(name) ?? '').toLowerCase();

  return (
    header('sec-purpose').includes('prefetch') ||
    header('purpose') === 'prefetch' ||
    header('x-purpose') === 'preview' ||
    header('x-moz') === 'prefetch'
  );
}

/** Scanner-fetched lifecycle links never create sessions; record only human clicks and always redirect, even for
 * invalid tokens or destinations. This browser route is registered outside the generated API. */
export const handleEmailLinkClick: RequestHandler = (req, res) => {
  const intent = readReturnToken(req.query.t);

  // Unusable tokens redirect home rather than showing a token error to someone who never saw the token.
  if (!intent) {
    res.redirect(302, config.BASE_URL);
    return;
  }

  // Bounded before it reaches an analytics property or a URL: it is free text
  // from a public query string, and its only job is to name which link this was.
  const content = typeof req.query.c === 'string' && req.query.c ? req.query.c.slice(0, 64) : 'unknown';

  // Fall back home for an unapproved destination: arrival is more useful than an error page.
  const destination =
    resolveDestination(req.query.to, intent.campaign, content) ?? withCampaignTags('/', intent.campaign, content);

  const verdict = classifyHit(intent, content, isMachineFetch(req));

  if (verdict === 'human') {
    captureEmailLinkClicked({
      userId: intent.userId,
      kind: intent.kind,
      campaign: intent.campaign,
      content,
    });
  }

  logger.info(
    { 'email.kind': intent.kind, userId: intent.userId, campaign: intent.campaign, content, verdict },
    'Email link followed',
  );

  // `repeat` is a person clicking the same cover twice, so it travels like a
  // reader; only the verdicts that say "not a person at all" suppress analytics.
  const followsAsReader = verdict === 'human' || verdict === 'repeat';

  res.redirect(302, followsAsReader ? destination : withAnalyticsSuppressed(destination));
};
