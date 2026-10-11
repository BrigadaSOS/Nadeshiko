import '@config/boot';
import { AppDataSource } from '@config/database';
import { logger } from '@config/log';
import { ShirabeConnection } from '@app/models/ShirabeConnection';
import { reencryptTokens } from '@app/services/shirabe/connection';

/** Re-encrypts stored Shirabe tokens after rotation. Deploy current plus previous secret, run this
 * resumable/idempotent batch, then remove previous; rows already on the current key are skipped and failures are
 * reported per row. Usage order is part of the rotation safety contract. */
const BATCH_SIZE = 200;

async function main(): Promise<void> {
  await AppDataSource.initialize();

  let scanned = 0;
  let rewritten = 0;
  let failed = 0;

  try {
    for (let skip = 0; ; skip += BATCH_SIZE) {
      const batch = await ShirabeConnection.find({ order: { id: 'ASC' }, skip, take: BATCH_SIZE });
      if (batch.length === 0) break;

      for (const connection of batch) {
        scanned += 1;
        try {
          if (await reencryptTokens(connection)) rewritten += 1;
        } catch (error) {
          // One unreadable row must not stop the batch: report it and continue, since missing previous-key material
          // cannot be repaired while other rows can still rotate.
          failed += 1;
          logger.error({ err: error, userId: connection.userId }, 'Could not re-encrypt Shirabe tokens');
        }
      }
    }

    logger.info({ scanned, rewritten, skipped: scanned - rewritten - failed, failed }, 'Shirabe token re-encryption');
    if (failed > 0) process.exitCode = 1;
  } finally {
    await AppDataSource.destroy();
  }
}

void main();
