import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BetterAuthApiKeyV21742200000000 implements MigrationInterface {
  name = 'BetterAuthApiKeyV21742200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // @better-auth/api-key 1.5.x renamed userId → referenceId and added configId
    await queryRunner.query(`ALTER TABLE "apikey" RENAME COLUMN "userId" TO "referenceId"`);
    await queryRunner.query(`ALTER INDEX "IDX_apikey_userId" RENAME TO "IDX_apikey_referenceId"`);
    await queryRunner.query(`
      ALTER TABLE "apikey"
        ADD COLUMN "configId" varchar NOT NULL DEFAULT 'default'
    `);
    await queryRunner.query(`CREATE INDEX "IDX_apikey_configId" ON "apikey" ("configId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_apikey_configId"`);
    await queryRunner.query(`ALTER TABLE "apikey" DROP COLUMN "configId"`);
    await queryRunner.query(`ALTER INDEX "IDX_apikey_referenceId" RENAME TO "IDX_apikey_userId"`);
    await queryRunner.query(`ALTER TABLE "apikey" RENAME COLUMN "referenceId" TO "userId"`);
  }
}
