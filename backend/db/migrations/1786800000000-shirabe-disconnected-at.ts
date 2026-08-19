import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * When Shirabe last refused a reader's key.
 *
 * A link can end at the other end -- revoked from the reader's Shirabe access
 * list, or swept for being idle -- and nothing on this side could represent
 * that. The row stayed healthy-looking, the settings page went on naming the
 * account, and every word lookup spent a doomed round trip before falling back
 * to the default dictionaries. This column is what lets a dead link say so.
 *
 * Nullable with no backfill, and null is the ordinary state: every existing row
 * is assumed live until Shirabe actually refuses it, which is the same
 * assumption the code made before this column existed.
 */
export class ShirabeDisconnectedAt1786800000000 implements MigrationInterface {
  name = 'ShirabeDisconnectedAt1786800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ShirabeConnection" ADD COLUMN "disconnected_at" timestamptz`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ShirabeConnection" DROP COLUMN "disconnected_at"`);
  }
}
