import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What the dictionaries in a reader's Shirabe stack are called.
 *
 * The stack is a list of slugs, and a slug is not a name: a reader's own Yomitan
 * uploads are filed under content hashes, so the connections settings page was
 * printing `yomitan-c89af12122021a8a` at the person who had uploaded 三省堂国語辞典.
 * Only Shirabe knows the names, so they are copied alongside the stack they
 * describe and refreshed with it.
 *
 * Defaults to an empty object rather than being backfilled: every existing row
 * picks its names up on the next stack refresh, and until then the settings page
 * falls back to the slug, which is what it showed before this column existed.
 */
export class ShirabeStackNames1786600000000 implements MigrationInterface {
  name = 'ShirabeStackNames1786600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ShirabeConnection" ADD COLUMN "stack_names" jsonb NOT NULL DEFAULT '{}'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ShirabeConnection" DROP COLUMN "stack_names"`);
  }
}
