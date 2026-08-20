import { EntityNotFoundError } from 'typeorm';
import type { User } from '@app/models';
import { config } from '@config/config';
import { encryptSecret, decryptSecret } from '@lib/secretBox';
import { mutateUserPreferences } from '@app/controllers/preferencesController';

/**
 * The link at the bottom of every lifecycle email.
 *
 * A SEALED TOKEN RATHER THAN A STORED ONE, which is the whole reason this is
 * twenty lines and not a table. The recipient is not signed in -- that is the
 * point, an unsubscribe that first demanded a password would be a dark pattern
 * and mailbox providers treat it as one -- so the link has to carry its own
 * proof of who it speaks for. Sealing the account id means no row to issue, none
 * to expire, and none to clean up.
 *
 * The account id rides INSIDE the sealed payload, which is what makes the link
 * unforgeable: AES-GCM authenticates the plaintext, so a token naming another
 * account cannot be produced without the key. Note the id deliberately does NOT
 * travel as `aad` -- associated data has to be reproduced to open a payload, and
 * the whole problem here is that the id is not known until the payload is open.
 *
 * The purpose is its own derived key, so a feedback form token can never be
 * spent here and this can never be spent there -- see `keyFor` in
 * `@lib/secretBox`.
 *
 * DELIBERATELY DOES NOT EXPIRE. An unsubscribe link is read when the reader gets
 * round to it, which for a monthly recap may be months after we sent it, and a
 * link that answers "this expired, sign in instead" is the exact failure that
 * turns an opt-out into a spam complaint. There is nothing to steal: the token
 * grants one act on one preference, and an attacker who forges every one of them
 * has succeeded in making us send less mail.
 */
const UNSUBSCRIBE_CONTEXT = { purpose: 'email.unsubscribe' } as const;

/**
 * The same key better-auth signs sessions with, reused for the same reason
 * `feedbackController` reuses it: it is the one secret guaranteed present in
 * every environment. A dedicated optional secret would be unset somewhere, and
 * "unset" here has to mean "no unsubscribe link works", which is the one failure
 * mode this feature must not have.
 */
function unsubscribeSecret(): string {
  return config.BETTER_AUTH_SECRET;
}

interface UnsubscribeToken {
  userId: number;
}

export function issueUnsubscribeToken(userId: number): string {
  return encryptSecret(JSON.stringify({ userId } satisfies UnsubscribeToken), unsubscribeSecret(), UNSUBSCRIBE_CONTEXT);
}

/**
 * The account this token speaks for, or null if it speaks for nobody.
 *
 * Every failure -- forged, truncated by a mail client that wrapped the URL,
 * sealed under a rotated secret -- collapses to null on purpose. The caller
 * answers the same way regardless, because telling a stranger which of those it
 * was is telling them something about a token they do not hold.
 */
export function readUnsubscribeToken(token: string): number | null {
  try {
    const payload = JSON.parse(decryptSecret(token, unsubscribeSecret(), UNSUBSCRIBE_CONTEXT)) as UnsubscribeToken;
    const userId = Number(payload?.userId);
    return Number.isInteger(userId) && userId > 0 ? userId : null;
  } catch {
    return null;
  }
}

/**
 * The two links a lifecycle email carries, both minted from one token.
 *
 * TWO OF THEM BECAUSE THEY HAVE DIFFERENT AUDIENCES, and conflating them breaks
 * one or the other:
 *
 *   `oneClick` goes in the `List-Unsubscribe` header and is POSTed by Gmail or
 *   Outlook with no person present (RFC 8058). It must hit the API directly --
 *   a provider will not render a confirmation page, it will just post.
 *
 *   `page` is the link a reader actually sees and clicks, and must be a GET that
 *   changes NOTHING until they confirm. Mail scanners fetch every link in a
 *   message before the recipient sees it; a GET that unsubscribed would opt
 *   people out of mail they never even opened.
 *
 * Both hang off `BASE_URL`, which is the site origin -- the Nitro proxy forwards
 * `/v1/**` to the backend, so the one-click URL is same-origin with the page.
 */
export function unsubscribeUrls(userId: number): { oneClick: string; page: string } {
  const token = encodeURIComponent(issueUnsubscribeToken(userId));

  return {
    oneClick: `${config.BASE_URL}/v1/email/unsubscribe?token=${token}`,
    page: `${config.BASE_URL}/unsubscribe?token=${token}`,
  };
}

/**
 * Turn the lifecycle mail off for an account.
 *
 * IDEMPOTENT, and that is not incidental: `List-Unsubscribe-Post` lets a mailbox
 * provider fire this without a person involved, and Gmail in particular may
 * retry. The second call has to be as quiet as the first.
 *
 * Goes through `mutateUserPreferences` rather than a read-modify-write of its
 * own, because the whole preferences column is rewritten on every change: an
 * unsubscribe landing at the same moment as a settings save would otherwise drop
 * whichever wrote first. Losing a translation-language choice would be bad
 * enough; losing somebody turning their activity log OFF is a privacy setting
 * silently undone by an unrelated click in an email.
 *
 * Returns false only when the account is gone -- not an error worth showing a
 * reader, since an unsubscribe for a deleted account has already got what it
 * wanted.
 */
export async function unsubscribeFromProductEmails(userId: number): Promise<boolean> {
  try {
    await mutateUserPreferences(userId, (current) => ({ ...current, productEmails: { enabled: false } }));
    return true;
  } catch (error) {
    if (error instanceof EntityNotFoundError) return false;
    throw error;
  }
}

/**
 * Whether we may send this account lifecycle mail. Absent means yes; see the
 * note on `UserPreferences.productEmails`.
 */
export function acceptsProductEmails(preferences: User['preferences'] | null | undefined): boolean {
  return preferences?.productEmails?.enabled !== false;
}
