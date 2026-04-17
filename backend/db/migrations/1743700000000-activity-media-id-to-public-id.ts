import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ActivityMediaIdToPublicId1743700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "UserActivity" ADD COLUMN "media_public_id" varchar`);
    await queryRunner.query(`
      UPDATE "UserActivity" ua
      SET "media_public_id" = m."public_id"
      FROM "Media" m
      WHERE ua."media_id" = m."id"
    `);
    await queryRunner.query(`ALTER TABLE "UserActivity" DROP COLUMN "media_id"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "UserActivity" ADD COLUMN "media_id" int`);
    await queryRunner.query(`
      UPDATE "UserActivity" ua
      SET "media_id" = m."id"
      FROM "Media" m
      WHERE ua."media_public_id" = m."public_id"
    `);
    await queryRunner.query(`ALTER TABLE "UserActivity" DROP COLUMN "media_public_id"`);
  }
}
