import type { MigrationInterface, QueryRunner } from 'typeorm';

export class FinalizeUppercaseAnnouncementType1743450000000 implements MigrationInterface {
  name = 'FinalizeUppercaseAnnouncementType1743450000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "Announcement"
      SET type = UPPER(type)
      WHERE type IN ('info', 'warning', 'maintenance')
    `);
    await queryRunner.query(`ALTER TABLE "Announcement" DROP CONSTRAINT IF EXISTS "Announcement_type_check"`);
    await queryRunner.query(`ALTER TABLE "Announcement" ALTER COLUMN "type" SET DEFAULT 'INFO'`);
    await queryRunner.query(`
      ALTER TABLE "Announcement"
      ADD CONSTRAINT "Announcement_type_check"
      CHECK ("type" IN ('INFO', 'WARNING', 'MAINTENANCE'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "Announcement"
      SET type = LOWER(type)
      WHERE type IN ('INFO', 'WARNING', 'MAINTENANCE')
    `);
    await queryRunner.query(`ALTER TABLE "Announcement" DROP CONSTRAINT IF EXISTS "Announcement_type_check"`);
    await queryRunner.query(`ALTER TABLE "Announcement" ALTER COLUMN "type" SET DEFAULT 'info'`);
    await queryRunner.query(`
      ALTER TABLE "Announcement"
      ADD CONSTRAINT "Announcement_type_check"
      CHECK ("type" IN ('info', 'warning', 'maintenance'))
    `);
  }
}
