import type { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateDefaultQuotaLimit1742300000000 implements MigrationInterface {
  name = 'UpdateDefaultQuotaLimit1742300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" ALTER COLUMN "monthly_quota_limit" SET DEFAULT 5000`);
    await queryRunner.query(`UPDATE "User" SET "monthly_quota_limit" = 5000 WHERE "monthly_quota_limit" = 2500`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "User" SET "monthly_quota_limit" = 2500 WHERE "monthly_quota_limit" = 5000`);
    await queryRunner.query(`ALTER TABLE "User" ALTER COLUMN "monthly_quota_limit" SET DEFAULT 2500`);
  }
}
