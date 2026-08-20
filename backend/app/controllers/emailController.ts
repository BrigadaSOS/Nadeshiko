import type { UnsubscribeFromEmail } from 'generated/routes/email';
import { InvalidRequestError } from '@app/errors';
import { logger } from '@config/log';
import { readUnsubscribeToken, unsubscribeFromProductEmails } from '@app/services/email/unsubscribe';

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
  const userId = readUnsubscribeToken(query.token);

  if (userId === null) {
    // Forged, corrupt, or wrapped by a mail client that broke the URL. The
    // reader can still turn it off in settings, which is what the page says.
    throw new InvalidRequestError('This unsubscribe link is not valid. You can change this in your account settings.');
  }

  const applied = await unsubscribeFromProductEmails(userId);

  // No address, no id: this line exists to show the endpoint is being reached,
  // and an unsubscribe is the one event where the person has just told us they
  // want less of our attention, not more of it recorded.
  logger.info({ applied }, 'Unsubscribed from product emails');

  return respond.with200().body({ unsubscribed: true });
};
