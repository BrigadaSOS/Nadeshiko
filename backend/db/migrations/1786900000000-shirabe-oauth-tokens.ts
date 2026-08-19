import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A linked Shirabe account is held as an OAuth token pair now, not as a key.
 *
 * Shirabe became an ordinary OAuth 2 authorization server: what a connected app
 * walks away with is an access token that lives an hour and a refresh token
 * that rotates on every renewal, both under a grant the reader can revoke from
 * their access list. So the row holds both, encrypted the way the key was, plus
 * when the access token runs out -- which is what tells the credential route to
 * renew before handing it out rather than after a lookup has already failed.
 *
 * `token_prefix` goes with the key: the settings page identified the link by
 * the key's first characters, which Shirabe's access list also printed. A grant
 * is named there by the app and the machine instead, and there is nothing on
 * this side to compare.
 *
 * Existing rows are deleted rather than migrated. Nothing can turn a key into a
 * token pair, the keys themselves were revoked by Shirabe's own migration, and
 * this feature has not shipped: the rows are staging and development links,
 * relinked in a click.
 */
export class ShirabeOauthTokens1786900000000 implements MigrationInterface {
  name = 'ShirabeOauthTokens1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "ShirabeConnection"`);
    await queryRunner.query(`ALTER TABLE "ShirabeConnection" DROP COLUMN "token_ciphertext"`);
    await queryRunner.query(`ALTER TABLE "ShirabeConnection" DROP COLUMN "token_prefix"`);
    await queryRunner.query(`ALTER TABLE "ShirabeConnection" ADD COLUMN "access_token_ciphertext" text NOT NULL`);
    await queryRunner.query(`ALTER TABLE "ShirabeConnection" ADD COLUMN "access_token_expires_at" timestamptz NOT NULL`);
    await queryRunner.query(`ALTER TABLE "ShirabeConnection" ADD COLUMN "refresh_token_ciphertext" text NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "ShirabeConnection"`);
    await queryRunner.query(`ALTER TABLE "ShirabeConnection" DROP COLUMN "refresh_token_ciphertext"`);
    await queryRunner.query(`ALTER TABLE "ShirabeConnection" DROP COLUMN "access_token_expires_at"`);
    await queryRunner.query(`ALTER TABLE "ShirabeConnection" DROP COLUMN "access_token_ciphertext"`);
    await queryRunner.query(`ALTER TABLE "ShirabeConnection" ADD COLUMN "token_prefix" varchar(32) NOT NULL`);
    await queryRunner.query(`ALTER TABLE "ShirabeConnection" ADD COLUMN "token_ciphertext" text NOT NULL`);
  }
}
