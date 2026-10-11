import { EntityNotFoundError } from 'typeorm';
import { User } from '@app/models';
import { config } from '@config/config';
import { encryptSecret, decryptSecret } from '@lib/secretBox';
import { mutateUserPreferences } from '@app/controllers/preferencesController';

/** Seal non-expiring opt-out tokens so old mail still works without login, exposed account data, or stored token
 * rows. */
/** Categories represent independently meaningful mail commitments; a support ask belongs to its containing category
 * or a separate bulk system, not a new key. */
export const EMAIL_CATEGORIES = ['recap', 'checkins', 'updates'] as const;

export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

const UNSUBSCRIBE_CONTEXT = { purpose: 'email.unsubscribe' } as const;

/** Reuse the always-present session secret so an unsubscribe link is not silently disabled in an environment missing
 * a new optional secret. */
function unsubscribeSecret(): string {
  return config.BETTER_AUTH_SECRET;
}

interface UnsubscribeToken {
  userId: number;
  /** A missing category means the whole list, preserving the meaning of pre-category tokens and the safe fallback
   * for an unplaceable token. */
  category?: EmailCategory;
}

export function issueUnsubscribeToken(userId: number, category?: EmailCategory): string {
  return encryptSecret(
    JSON.stringify({ userId, ...(category ? { category } : {}) } satisfies UnsubscribeToken),
    unsubscribeSecret(),
    UNSUBSCRIBE_CONTEXT,
  );
}

/** Collapse forged, truncated, and wrongly sealed tokens to the same null result so the caller does not reveal which
 * failure occurred. */
export function readUnsubscribeToken(token: string): UnsubscribeToken | null {
  try {
    const payload = JSON.parse(decryptSecret(token, unsubscribeSecret(), UNSUBSCRIBE_CONTEXT)) as UnsubscribeToken;
    const userId = Number(payload?.userId);
    if (!Number.isInteger(userId) || userId <= 0) return null;

    // Drop an unknown category and interpret it as the whole list; trusting a future category could under-unsubscribe
    // an old client.
    const category = EMAIL_CATEGORIES.includes(payload.category as EmailCategory) ? payload.category : undefined;

    return { userId, ...(category ? { category } : {}) };
  } catch {
    return null;
  }
}

/** Keep separate RFC 8058 POST and reader-facing GET links: scanners may fetch the GET, so it must change nothing
 * before confirmation. */
export function unsubscribeUrls(userId: number, category?: EmailCategory): { oneClick: string; page: string } {
  const token = encodeURIComponent(issueUnsubscribeToken(userId, category));

  return {
    oneClick: `${config.BASE_URL}/v1/email/unsubscribe?token=${token}`,
    page: `${config.BASE_URL}/unsubscribe?token=${token}`,
  };
}

/** Make unsubscribe idempotent and mutate preferences atomically; a concurrent settings save must not restore a
 * privacy choice. */
export async function unsubscribeFromProductEmails(userId: number): Promise<boolean> {
  try {
    await mutateUserPreferences(userId, (current) => ({ ...current, productEmails: { enabled: false } }));
    return true;
  } catch (error) {
    if (error instanceof EntityNotFoundError) return false;
    throw error;
  }
}

/** Resolve “absent follows master” on the server so the page receives ordinary booleans rather than duplicating
 * tri-state rules. */
export async function readEmailPreferences(
  userId: number,
): Promise<{ enabled: boolean; categories: Record<EmailCategory, boolean> } | null> {
  const user = await User.findOne({ where: { id: userId }, select: { id: true, preferences: true } });
  if (!user) return null;

  const enabled = acceptsProductEmails(user.preferences);

  return {
    enabled,
    categories: Object.fromEntries(
      EMAIL_CATEGORIES.map((category) => [category, acceptsProductEmails(user.preferences, category)]),
    ) as Record<EmailCategory, boolean>,
  };
}

/** Apply a partial patch so a stale page changes only its submitted switch and cannot overwrite another device's
 * preference. */
export async function updateEmailPreferences(
  userId: number,
  patch: Partial<Record<'enabled' | EmailCategory, boolean>>,
): Promise<boolean> {
  try {
    await mutateUserPreferences(userId, (current) => {
      const productEmails: NonNullable<User['preferences']>['productEmails'] = {
        enabled: current.productEmails?.enabled !== false,
        ...current.productEmails,
      };

      // Named only when it is being set, so a reader who has never touched the
      // master does not acquire an explicit one just by unticking a category.
      if (patch.enabled !== undefined) productEmails.enabled = patch.enabled;

      for (const category of EMAIL_CATEGORIES) {
        if (patch[category] !== undefined) productEmails[category] = patch[category];
      }

      return { ...current, productEmails };
    });
    return true;
  } catch (error) {
    if (error instanceof EntityNotFoundError) return false;
    throw error;
  }
}

/** A category opt-out changes only that category; use the shared mutation path so concurrent preference changes are
 * preserved. */
export async function setProductEmailCategory(
  userId: number,
  category: EmailCategory,
  enabled: boolean,
): Promise<boolean> {
  try {
    await mutateUserPreferences(userId, (current) => ({
      ...current,
      productEmails: {
        // Absent means "follow the master", which is true and stays true; naming
        // it here would turn a reader who never touched this into one who did.
        enabled: current.productEmails?.enabled !== false,
        ...current.productEmails,
        [category]: enabled,
      },
    }));
    return true;
  } catch (error) {
    if (error instanceof EntityNotFoundError) return false;
    throw error;
  }
}

/** Absent category consent follows the master switch, so an old global opt-out cannot become a new category opt-in. */
export function acceptsProductEmails(
  preferences: User['preferences'] | null | undefined,
  category?: EmailCategory,
): boolean {
  const productEmails = preferences?.productEmails;
  if (productEmails?.enabled === false) return false;
  if (!category) return true;

  return productEmails?.[category] !== false;
}
