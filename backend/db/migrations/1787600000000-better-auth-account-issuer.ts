import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Better Auth 1.7 scopes an account subject by issuer rather than provider id.
 * Adding the column in one nullable/backfill/not-null sequence keeps existing
 * credential, Google and Discord accounts usable throughout the migration.
 */
export class BetterAuthAccountIssuer1787600000000 implements MigrationInterface {
  name = 'BetterAuthAccountIssuer1787600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "account" ADD COLUMN "issuer" varchar`);
    await queryRunner.query(`
      UPDATE "account"
      SET "issuer" = CASE "provider_id"
        WHEN 'credential' THEN 'local:credential'
        WHEN 'google' THEN 'https://accounts.google.com'
        ELSE 'local:oauth:' || "provider_id"
      END
    `);
    await queryRunner.query(`ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "account" DROP CONSTRAINT "UQ_account_provider"`);
    await queryRunner.query(`
      ALTER TABLE "account"
      ADD CONSTRAINT "UQ_account_issuer" UNIQUE ("issuer", "account_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "account" DROP CONSTRAINT "UQ_account_issuer"`);
    await queryRunner.query(`
      ALTER TABLE "account"
      ADD CONSTRAINT "UQ_account_provider" UNIQUE ("provider_id", "account_id")
    `);
    await queryRunner.query(`ALTER TABLE "account" DROP COLUMN "issuer"`);
  }
}
