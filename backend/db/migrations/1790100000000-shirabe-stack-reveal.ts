import { MigrationInterface, QueryRunner } from 'typeorm';

export class ShirabeStackReveal1790100000000 implements MigrationInterface {
  name = 'ShirabeStackReveal1790100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ShirabeConnection" ADD COLUMN "stack_reveal" jsonb NOT NULL DEFAULT '{}'::jsonb`,
    );
    // Existing links need one stack read to learn their reveal settings.
    await queryRunner.query(`UPDATE "ShirabeConnection" SET "synced_at" = NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ShirabeConnection" DROP COLUMN "stack_reveal"`);
  }
}
