import { MigrationInterface, QueryRunner } from 'typeorm';

export class BaseEntityAlignment1740500000000 implements MigrationInterface {
  name = 'BaseEntityAlignment1740500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "updated_at" timestamp`);
    await queryRunner.query(`UPDATE "User" SET "updated_at" = COALESCE("updated_at", "modified_at", "created_at")`);

    await queryRunner.query(`ALTER TABLE "ApiAuth" ADD COLUMN IF NOT EXISTS "updated_at" timestamp`);
    await queryRunner.query(`UPDATE "ApiAuth" SET "updated_at" = COALESCE("updated_at", "created_at")`);

    await queryRunner.query(
      `ALTER TABLE "ApiAuthPermission" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP`,
    );
    await queryRunner.query(`ALTER TABLE "ApiAuthPermission" ADD COLUMN IF NOT EXISTS "updated_at" timestamp`);
    await queryRunner.query(`UPDATE "ApiAuthPermission" SET "updated_at" = COALESCE("updated_at", "created_at")`);

    await queryRunner.query(`ALTER TABLE "MediaExternalId" ADD COLUMN IF NOT EXISTS "updated_at" timestamp`);
    await queryRunner.query(`UPDATE "MediaExternalId" SET "updated_at" = COALESCE("updated_at", "created_at")`);

    await queryRunner.query(`ALTER TABLE "ReviewCheckRun" ADD COLUMN IF NOT EXISTS "updated_at" timestamp`);
    await queryRunner.query(`UPDATE "ReviewCheckRun" SET "updated_at" = COALESCE("updated_at", "created_at")`);

    await queryRunner.query(`ALTER TABLE "ReviewAllowlist" ADD COLUMN IF NOT EXISTS "updated_at" timestamp`);
    await queryRunner.query(`UPDATE "ReviewAllowlist" SET "updated_at" = COALESCE("updated_at", "created_at")`);

    await queryRunner.query(`ALTER TABLE "LabUserEnrollment" ADD COLUMN IF NOT EXISTS "created_at" timestamp`);
    await queryRunner.query(`UPDATE "LabUserEnrollment" SET "created_at" = COALESCE("created_at", "enrolled_at")`);
    await queryRunner.query(`ALTER TABLE "LabUserEnrollment" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "LabUserEnrollment" ALTER COLUMN "created_at" SET NOT NULL`);

    await queryRunner.query(`ALTER TABLE "LabUserEnrollment" ADD COLUMN IF NOT EXISTS "updated_at" timestamp`);
    await queryRunner.query(`UPDATE "LabUserEnrollment" SET "updated_at" = COALESCE("updated_at", "created_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "LabUserEnrollment" DROP COLUMN IF EXISTS "updated_at"`);
    await queryRunner.query(`ALTER TABLE "LabUserEnrollment" DROP COLUMN IF EXISTS "created_at"`);

    await queryRunner.query(`ALTER TABLE "ReviewAllowlist" DROP COLUMN IF EXISTS "updated_at"`);
    await queryRunner.query(`ALTER TABLE "ReviewCheckRun" DROP COLUMN IF EXISTS "updated_at"`);
    await queryRunner.query(`ALTER TABLE "MediaExternalId" DROP COLUMN IF EXISTS "updated_at"`);

    await queryRunner.query(`ALTER TABLE "ApiAuthPermission" DROP COLUMN IF EXISTS "updated_at"`);
    await queryRunner.query(`ALTER TABLE "ApiAuthPermission" DROP COLUMN IF EXISTS "created_at"`);

    await queryRunner.query(`ALTER TABLE "ApiAuth" DROP COLUMN IF EXISTS "updated_at"`);
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN IF EXISTS "updated_at"`);
  }
}
