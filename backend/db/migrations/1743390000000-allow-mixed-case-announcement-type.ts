import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowMixedCaseAnnouncementType1743390000000 implements MigrationInterface {
  name = 'AllowMixedCaseAnnouncementType1743390000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // This runs immediately before 1743400000000 so the existing data migration
    // can uppercase rows without tripping the original lowercase-only check.
    await queryRunner.query(`ALTER TABLE "Announcement" DROP CONSTRAINT IF EXISTS "Announcement_type_check"`);
    await queryRunner.query(`
      ALTER TABLE "Announcement"
      ADD CONSTRAINT "Announcement_type_check"
      CHECK ("type" IN ('info', 'warning', 'maintenance', 'INFO', 'WARNING', 'MAINTENANCE'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "Announcement"
      SET type = LOWER(type)
      WHERE type IN ('INFO', 'WARNING', 'MAINTENANCE')
    `);
    await queryRunner.query(`ALTER TABLE "Announcement" DROP CONSTRAINT IF EXISTS "Announcement_type_check"`);
    await queryRunner.query(`
      ALTER TABLE "Announcement"
      ADD CONSTRAINT "Announcement_type_check"
      CHECK ("type" IN ('info', 'warning', 'maintenance'))
    `);
  }
}
