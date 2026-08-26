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

/**
 * The unsubscribe link, and the `List-Unsubscribe-Post` target behind it.
 *
 * TWO CALLERS WITH DIFFERENT NEEDS, both served by this one handler:
 *
 *   - a person who clicked the link in a recap and is looking at a confirmation
 *     page, who needs to be told it worked;
 *   - Gmail or Outlook honouring `List-Unsubscribe-Post`, with nobody present,
 *     which needs a 2xx and may send the same request more than once.
 *
 * Hence idempotent, and hence a `200` for an account that no longer exists: the
 * state the caller asked for holds either way, and answering `404` would make a
 * provider record the unsubscribe as failed and go on showing the reader a
 * button that never works.
 *
 * The ONLY `400` is a token we cannot read at all. That is not a leak -- a
 * stranger has no token to test, and the one who does holds their own.
 *
 * The token arrives in the QUERY STRING, not a body, because RFC 8058 posts a
 * fixed `List-Unsubscribe=One-Click` body to the URI and discards whatever the
 * sender might have wanted to put there. See the note on the spec.
 */
export const unsubscribeFromEmail: UnsubscribeFromEmail = async ({ query }, respond) => {
  const intent = readUnsubscribeToken(query.token);

  if (intent === null) {
    // Forged, corrupt, or wrapped by a mail client that broke the URL. The
    // reader can still turn it off in settings, which is what the page says.
    throw new InvalidRequestError('This unsubscribe link is not valid. You can change this in your account settings.');
  }

  // THE CATEGORY THE MESSAGE CAME FROM, not everything we send. RFC 8058
  // unsubscribes the reader from "the list" that sent the message, and a
  // category is that list: somebody one-clicking out of a monthly recap has
  // said nothing about the one question we ask at day seven. A token with no
  // category still means everything -- that is what one minted before
  // categories existed meant, and the safe reading of one we cannot place.
  const applied = intent.category
    ? await setProductEmailCategory(intent.userId, intent.category, false)
    : await unsubscribeFromProductEmails(intent.userId);

  // No address, no id: this line exists to show the endpoint is being reached,
  // and an unsubscribe is the one event where the person has just told us they
  // want less of our attention, not more of it recorded.
  logger.info({ applied, category: intent.category ?? 'all' }, 'Unsubscribed from product emails');

  return respond.with200().body({ unsubscribed: true });
};

/**
 * What the unsubscribe page shows before the reader touches anything.
 *
 * READS AND NEVER WRITES, which is the whole reason it is a separate endpoint
 * from the one-click POST. Mail scanners fetch every link in a message before
 * the recipient sees it, so anything reachable by GET has to be safe to fetch by
 * a robot; the change happens on the PATCH, which no scanner will issue.
 */
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

/**
 * The reader's choices from that page.
 *
 * Partial by design: the page sends the switch that moved rather than the whole
 * set, so somebody on a page loaded ten minutes ago cannot silently revert a
 * change they made elsewhere in the meantime.
 */
export const updateEmailPreferencesByToken: UpdateEmailPreferencesByToken = async ({ body }, respond) => {
  const { token, ...patch } = body;
  const intent = readUnsubscribeToken(token);
  if (intent === null) {
    throw new InvalidRequestError('This unsubscribe link is not valid. You can change this in your account settings.');
  }

  const applied = await updateEmailPreferences(intent.userId, patch);
  const preferences = applied ? await readEmailPreferences(intent.userId) : null;

  // No address and no id in the log line, for the reason the unsubscribe handler
  // gives: this is the one moment the reader has asked for less of our
  // attention, not more of it written down.
  logger.info({ applied, changed: Object.keys(patch) }, 'Email preferences changed from a token');

  if (!preferences) {
    throw new InvalidRequestError('This unsubscribe link is not valid. You can change this in your account settings.');
  }

  return respond.with200().body(preferences);
};

/**
 * Headers a client sets when it is fetching a link nobody has asked for yet.
 *
 * The polite half of the problem: browsers and some scanners announce a
 * speculative fetch, and taking them at their word is free. The impolite half --
 * a headless Chrome walking every link in the message without a word about it --
 * is what `classifyHit` is for.
 *
 * A HEAD lands here too, because express routes it to the GET handler. Nobody
 * reading their email issues one.
 */
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

/**
 * Where every link in a lifecycle email points, and the only place a click is
 * counted.
 *
 * REGISTERED BY HAND rather than generated, for the reason the ZeptoMail webhook
 * is: this is a browser landing on a redirect, not part of the API contract the
 * SDK publishes, and a 302 is not a response shape the generator has any use
 * for.
 *
 * SIDE-EFFECT FREE BEYOND ONE ANALYTICS EVENT, and it has to stay that way. The
 * whole reason this endpoint exists is that mail scanners fetch every URL in a
 * message before the recipient sees it -- so anything this did on GET, it would
 * do for a robot, on somebody else's schedule. In particular it does NOT sign
 * anybody in: a session minted here is a session handed to whatever fetched the
 * link first. Readers whose session has lapsed sign in as they always have, and
 * with the 90-day session lifetime most of them no longer have to.
 *
 * ALWAYS REDIRECTS. There is no request shape that earns an error page: a
 * forged token, a destination we will not honour and a scanner all still end
 * with somebody -- possibly a person -- pointed at the site. What varies is
 * whether the click is recorded and whether the destination loads analytics.
 */
export const handleEmailLinkClick: RequestHandler = (req, res) => {
  const intent = readReturnToken(req.query.t);

  // Unreadable, forged, or rewritten by a mail client that decided our query
  // string needed improving. The reader is still real; the home page is a better
  // answer for them than a 400 explaining a token they never saw.
  if (!intent) {
    res.redirect(302, config.BASE_URL);
    return;
  }

  // Bounded before it reaches an analytics property or a URL: it is free text
  // from a public query string, and its only job is to name which link this was.
  const content = typeof req.query.c === 'string' && req.query.c ? req.query.c.slice(0, 64) : 'unknown';

  // A destination we will not honour falls back to the home page rather than
  // failing. Somebody clicked a link in a win-back email; landing them on the
  // site is the entire point, and the path is the least important part of it.
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
