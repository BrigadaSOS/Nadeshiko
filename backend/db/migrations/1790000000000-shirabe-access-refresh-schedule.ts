import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Store a renewal deadline separately from the token's real expiration. */
export class ShirabeAccessRefreshSchedule1790000000000 implements MigrationInterface {
  name = 'ShirabeAccessRefreshSchedule1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ShirabeConnection" ADD COLUMN "access_token_refresh_at" timestamptz`);
    // Existing links renew on their next use, then store a deadline based on
    // the lifetime Shirabe returns with the replacement token.
    await queryRunner.query(`UPDATE "ShirabeConnection" SET "access_token_refresh_at" = now()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ShirabeConnection" DROP COLUMN "access_token_refresh_at"`);
  }
}
