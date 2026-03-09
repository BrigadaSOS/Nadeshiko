import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeStudioNullable1741600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Media" ALTER COLUMN "studio" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "Media" ALTER COLUMN "studio" DROP DEFAULT`);
    await queryRunner.query(`UPDATE "Media" SET "studio" = NULL WHERE "studio" = 'UNKNOWN'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "Media" SET "studio" = 'UNKNOWN' WHERE "studio" IS NULL`);
    await queryRunner.query(`ALTER TABLE "Media" ALTER COLUMN "studio" SET DEFAULT 'UNKNOWN'`);
    await queryRunner.query(`ALTER TABLE "Media" ALTER COLUMN "studio" SET NOT NULL`);
  }
}
