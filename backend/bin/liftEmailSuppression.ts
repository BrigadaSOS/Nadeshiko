import '@config/boot';
import { AppDataSource } from '@config/database';
import { logger } from '@config/log';
import { normalizeAddress, removeSuppression } from '@app/services/email/suppression';
import { deleteProviderSuppression, isZohoConfigured } from '@app/services/email/zeptomailApi';

/** Clear local then provider suppression; provider failure leaves mail blocked and is reported as failure. Lift only
 * false positives or recovered soft bounces, not unexplained complaints. Usage: `npm run email:lift -w backend --
 * <address>`. */
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
      // A missing local row is not an error; still call the provider because its suppression list may retain the
      // address.
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
