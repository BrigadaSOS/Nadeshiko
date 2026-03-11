import type { MigrationInterface, QueryRunner } from 'typeorm';

export class DropSoftDeleteColumns1742000000000 implements MigrationInterface {
  name = 'DropSoftDeleteColumns1742000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Episode" DROP COLUMN IF EXISTS "deleted_at"`);
    await queryRunner.query(`ALTER TABLE "Media" DROP COLUMN IF EXISTS "deleted_at"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Media" ADD COLUMN "deleted_at" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "Episode" ADD COLUMN "deleted_at" TIMESTAMP`);
  }
}
