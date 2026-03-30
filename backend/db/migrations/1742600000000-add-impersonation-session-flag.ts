import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImpersonationSessionFlag1742600000000 implements MigrationInterface {
  name = 'AddImpersonationSessionFlag1742600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "session" ADD COLUMN "impersonated_by" TEXT`);
    await queryRunner.query(`ALTER TABLE "User" ADD COLUMN "banned" BOOLEAN NOT NULL DEFAULT FALSE`);
    await queryRunner.query(`ALTER TABLE "User" ADD COLUMN "ban_reason" TEXT`);
    await queryRunner.query(`ALTER TABLE "User" ADD COLUMN "ban_expires" TIMESTAMPTZ`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "session" DROP COLUMN "impersonated_by"`);
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "banned"`);
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "ban_reason"`);
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "ban_expires"`);
  }
}
