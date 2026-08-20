import '@config/boot';
import { AppDataSource } from '@config/database';
import { logger } from '@config/log';
import { normalizeAddress, removeSuppression } from '@app/services/email/suppression';
import { deleteProviderSuppression, isZohoConfigured } from '@app/services/email/zeptomailApi';

/**
 * Forgive an address: remove it from OUR suppression list and from ZeptoMail's.
 *
 *   npm run email:lift -w backend -- someone@example.com
 *
 * THE ONLY CORRECT WAY TO DO THIS. A `DELETE FROM "EmailSuppression"` in psql
 * looks like it worked and does half the job. Auto-suppression is enabled on the
 * Agent, so ZeptoMail keeps a list of its own; clearing only our row leaves the
 * app believing it can write to somebody the relay silently still refuses, and
 * nothing anywhere reports that the two disagree. Use this script.
 *
 * ORDER MATTERS, and it is the safe way round. Our row goes first, because if the
 * provider call then fails the address is merely still blocked -- which is the
 * state it was already in, and the script says so and exits non-zero. Doing it
 * the other way would leave an address ZeptoMail will now deliver to and we still
 * refuse, which no log line would ever remind anybody about.
 *
 * WHO SHOULD BE LIFTED, and mostly the answer is nobody. A hard bounce is usually
 * a typo -- an address that never existed and should stay suppressed forever.
 * The cases this exists for are a `repeated_soft_bounce` on a mailbox that was
 * full and is not now, and undoing a false positive. A `complaint` should be
 * lifted only if you know exactly why it was wrong: somebody pressed the button
 * that tells their provider we are spam, and sending again is how one complaint
 * becomes a blocked domain.
 */
async function main(): Promise<void> {
  const address = normalizeAddress(process.argv[2]);

  if (!address) {
    logger.error('Usage: npm run email:lift -w backend -- <address>');
    process.exitCode = 1;
    return;
  }

  await AppDataSource.initialize();

  try {
    const row = await removeSuppression(address);

    if (!row) {
      // Not an error. The address may already have been lifted, or never
      // suppressed -- but the provider half can still be standing, so the
      // provider call below runs regardless.
      logger.info('No suppression row here for that address');
    } else {
      logger.info({ 'email.cause': row.cause }, 'Removed our suppression row');
    }

    if (!isZohoConfigured()) {
      logger.warn(
        'ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN are not set, so ZeptoMail still has ' +
          'this address on its own list and will keep refusing it. Remove it by hand in the console.',
      );
      process.exitCode = 1;
      return;
    }

    const lifted = await deleteProviderSuppression(address);

    if (lifted) {
      logger.info('Lifted at ZeptoMail too. Mail to this address will be attempted again.');
      return;
    }

    logger.error(
      'ZeptoMail did not confirm the delete, so the address is still refused at the relay. ' +
        'Check the console and the Zoho OAuth credentials before assuming it is forgiven.',
    );
    process.exitCode = 1;
  } finally {
    await AppDataSource.destroy();
  }
}

void main();
