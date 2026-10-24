import '@config/boot';
import { AppDataSource } from '@config/database';
import { logger } from '@config/log';
import { normalizeAddress, removeSuppression } from '@app/services/email/suppression';
import { deleteSesSuppression } from '@app/mailers/sesSend';

/** Clear our row, then SES's account-level list; leaving either half standing keeps the address refused. Lift only
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
      // A missing local row is not an error; SES's list may still hold the address.
      logger.info('No suppression row here for that address');
    } else {
      logger.info({ 'email.cause': row.cause }, 'Removed our suppression row');
    }

    try {
      await deleteSesSuppression(address);
      logger.info('Lifted at SES too. Mail to this address will be attempted again.');
    } catch (error) {
      logger.error(
        { err: error },
        'SES did not confirm the delete, so it still refuses the address. Check the SES_AWS_* credentials and the ' +
          'account-level suppression list before assuming it is forgiven.',
      );
      process.exitCode = 1;
    }
  } finally {
    await AppDataSource.destroy();
  }
}

void main();
