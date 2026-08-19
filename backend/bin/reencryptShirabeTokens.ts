import '@config/boot';
import { AppDataSource } from '@config/database';
import { logger } from '@config/log';
import { ShirabeConnection } from '@app/models/ShirabeConnection';
import { reencryptTokens } from '@app/services/shirabe/connection';

/**
 * Move every stored Shirabe token pair onto the current encryption secret.
 *
 * The step that lets a key rotation FINISH. `secretBox` stamps each ciphertext
 * with the id of the key that sealed it and can read across the current secret
 * and `SHIRABE_CONNECTION_SECRET_PREVIOUS`, so a rotation is survivable the
 * moment the new value is deployed -- but nothing rewrites the rows, so without
 * this the outgoing key can never be retired and every future rotation adds
 * another key that must be kept forever.
 *
 * The runbook:
 *
 *   1. new value into SSM as SHIRABE_CONNECTION_SECRET, the outgoing one into
 *      SHIRABE_CONNECTION_SECRET_PREVIOUS
 *   2. wire _PREVIOUS into the deploy config and deploy (Kamal aborts on a name
 *      it cannot resolve, so it is only listed while a rotation is running)
 *   3. run this
 *   4. unwire _PREVIOUS, drop it from SSM, deploy
 *
 * Idempotent and resumable by construction: a row already on the current key is
 * skipped on a string comparison, so a pass interrupted halfway is finished by
 * running it again. Safe to run when nothing has rotated -- it writes nothing.
 *
 * Batched rather than loaded whole: this table is one row per linked reader and
 * will not stay small, and a rotation is exactly when nobody wants the process
 * that is rewriting credentials to be the one that runs out of memory.
 */
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
          // One unreadable row must not abandon the rest: the likeliest cause is
          // a key that was rotated without `_PREVIOUS` being kept, and that row
          // is already beyond saving. Reporting it and carrying on leaves the
          // other readers rotated rather than everybody stuck behind the worst
          // row in the table.
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
