import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SimplifyReportStatuses1743300000000 implements MigrationInterface {
  name = 'SimplifyReportStatuses1743300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Map old statuses to new ones:
    //   PENDING  → OPEN
    //   CONCERN  → OPEN       (was just "looked at but undecided")
    //   ACCEPTED → PROCESSING
    //   REJECTED → DISMISSED
    //   RESOLVED → FIXED
    //   IGNORED  → DISMISSED
    // Merge statuses that map to the same new value before the enum swap.
    // PENDING stays PENDING (maps to OPEN), ACCEPTED stays ACCEPTED (maps to PROCESSING),
    // RESOLVED stays RESOLVED (maps to FIXED). Only CONCERN and IGNORED need updating.
    await queryRunner.query(`
      UPDATE "Report" SET status = 'PENDING' WHERE status = 'CONCERN'
    `);
    await queryRunner.query(`
      UPDATE "Report" SET status = 'REJECTED' WHERE status = 'IGNORED'
    `);

    // Replace the enum type
    await queryRunner.query(`
      ALTER TYPE "report_status" RENAME TO "report_status_old"
    `);
    await queryRunner.query(`
      CREATE TYPE "report_status" AS ENUM ('OPEN', 'PROCESSING', 'FIXED', 'DISMISSED')
    `);

    // Drop the default before changing the column type (PG can't auto-cast the default)
    await queryRunner.query(`
      ALTER TABLE "Report" ALTER COLUMN "status" DROP DEFAULT
    `);

    // Migrate the column: old values -> new values
    await queryRunner.query(`
      ALTER TABLE "Report"
        ALTER COLUMN "status" TYPE "report_status"
        USING CASE status::text
          WHEN 'PENDING'  THEN 'OPEN'::report_status
          WHEN 'ACCEPTED' THEN 'PROCESSING'::report_status
          WHEN 'REJECTED' THEN 'DISMISSED'::report_status
          WHEN 'RESOLVED' THEN 'FIXED'::report_status
        END
    `);

    await queryRunner.query(`
      ALTER TABLE "Report" ALTER COLUMN "status" SET DEFAULT 'OPEN'
    `);

    await queryRunner.query(`DROP TYPE "report_status_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "report_status" RENAME TO "report_status_new"
    `);
    await queryRunner.query(`
      CREATE TYPE "report_status" AS ENUM ('PENDING', 'CONCERN', 'ACCEPTED', 'REJECTED', 'RESOLVED', 'IGNORED')
    `);

    await queryRunner.query(`
      ALTER TABLE "Report" ALTER COLUMN "status" DROP DEFAULT
    `);

    await queryRunner.query(`
      ALTER TABLE "Report"
        ALTER COLUMN "status" TYPE "report_status"
        USING CASE status::text
          WHEN 'OPEN'       THEN 'PENDING'::report_status
          WHEN 'PROCESSING' THEN 'ACCEPTED'::report_status
          WHEN 'FIXED'      THEN 'RESOLVED'::report_status
          WHEN 'DISMISSED'  THEN 'REJECTED'::report_status
        END
    `);

    await queryRunner.query(`
      ALTER TABLE "Report" ALTER COLUMN "status" SET DEFAULT 'PENDING'
    `);

    await queryRunner.query(`DROP TYPE "report_status_new"`);
  }
}
