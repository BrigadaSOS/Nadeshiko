import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReviewSystem1739700000000 implements MigrationInterface {
  name = 'AddReviewSystem1739700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ===== NEW ENUM TYPES =====
    await queryRunner.query(`CREATE TYPE report_source AS ENUM ('USER', 'AUTO')`);
    await queryRunner.query(`CREATE TYPE report_target_type AS ENUM ('SEGMENT', 'EPISODE', 'MEDIA')`);
    await queryRunner.query(`CREATE TYPE review_check_target_type AS ENUM ('MEDIA', 'EPISODE')`);

    // ===== Extend report_status with new values =====
    await queryRunner.query(`ALTER TYPE report_status ADD VALUE IF NOT EXISTS 'CONCERN'`);
    await queryRunner.query(`ALTER TYPE report_status ADD VALUE IF NOT EXISTS 'IGNORED'`);

    // ===== Extend report_reason with auto-check codes =====
    await queryRunner.query(`ALTER TYPE report_reason ADD VALUE IF NOT EXISTS 'LOW_SEGMENT_MEDIA'`);
    await queryRunner.query(`ALTER TYPE report_reason ADD VALUE IF NOT EXISTS 'EMPTY_EPISODES'`);
    await queryRunner.query(`ALTER TYPE report_reason ADD VALUE IF NOT EXISTS 'MISSING_EPISODES_AUTO'`);
    await queryRunner.query(`ALTER TYPE report_reason ADD VALUE IF NOT EXISTS 'BAD_SEGMENT_RATIO'`);
    await queryRunner.query(`ALTER TYPE report_reason ADD VALUE IF NOT EXISTS 'MEDIA_WITH_NO_EPISODES'`);
    await queryRunner.query(`ALTER TYPE report_reason ADD VALUE IF NOT EXISTS 'MISSING_TRANSLATIONS'`);
    await queryRunner.query(`ALTER TYPE report_reason ADD VALUE IF NOT EXISTS 'DB_ES_SYNC_ISSUES'`);
    await queryRunner.query(`ALTER TYPE report_reason ADD VALUE IF NOT EXISTS 'HIGH_REPORT_DENSITY'`);

    // ===== CREATE ReviewCheckRun TABLE (must exist before Report FK) =====
    await queryRunner.query(`
      CREATE TABLE "ReviewCheckRun" (
        "id" SERIAL PRIMARY KEY,
        "check_name" varchar NOT NULL,
        "category" varchar,
        "result_count" int NOT NULL,
        "threshold_used" jsonb NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    // ===== CREATE ReviewCheck TABLE =====
    await queryRunner.query(`
      CREATE TABLE "ReviewCheck" (
        "id" SERIAL PRIMARY KEY,
        "name" varchar NOT NULL UNIQUE,
        "label" varchar NOT NULL,
        "description" text NOT NULL,
        "target_type" review_check_target_type NOT NULL,
        "threshold" jsonb NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP
      )
    `);

    // ===== CREATE ReviewAllowlist TABLE =====
    await queryRunner.query(`
      CREATE TABLE "ReviewAllowlist" (
        "id" SERIAL PRIMARY KEY,
        "check_name" varchar NOT NULL,
        "media_id" int NOT NULL,
        "episode_number" int,
        "reason" varchar,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        UNIQUE ("check_name", "media_id", "episode_number")
      )
    `);

    // ===== REDESIGN Report TABLE =====
    // Migrate existing Report data to new schema

    // Add new columns
    await queryRunner.query(`ALTER TABLE "Report" ADD COLUMN "source" report_source`);
    await queryRunner.query(`ALTER TABLE "Report" ADD COLUMN "target_type" report_target_type`);
    await queryRunner.query(`ALTER TABLE "Report" ADD COLUMN "target_media_id" int`);
    await queryRunner.query(`ALTER TABLE "Report" ADD COLUMN "target_episode_number" int`);
    await queryRunner.query(`ALTER TABLE "Report" ADD COLUMN "target_segment_uuid" varchar`);
    await queryRunner.query(`ALTER TABLE "Report" ADD COLUMN "review_check_run_id" int REFERENCES "ReviewCheckRun"("id") ON DELETE SET NULL`);
    await queryRunner.query(`ALTER TABLE "Report" ADD COLUMN "data" jsonb`);

    // Migrate existing data: all existing reports are USER reports
    await queryRunner.query(`UPDATE "Report" SET "source" = 'USER'`);

    // Migrate target info from old columns
    // For SEGMENT reports: targetType = SEGMENT, targetSegmentUuid = targetId, targetMediaId from segment lookup
    await queryRunner.query(`
      UPDATE "Report" r SET
        "target_type" = 'SEGMENT',
        "target_segment_uuid" = r.target_id,
        "target_media_id" = COALESCE(s.media_id, 0)
      FROM "Segment" s
      WHERE r.report_type = 'SEGMENT' AND s.uuid = r.target_id
    `);

    // For SEGMENT reports with no matching segment, set mediaId to 0
    await queryRunner.query(`
      UPDATE "Report" SET
        "target_type" = 'SEGMENT',
        "target_segment_uuid" = target_id,
        "target_media_id" = 0
      WHERE report_type = 'SEGMENT' AND "target_type" IS NULL
    `);

    // For MEDIA reports: targetType = MEDIA, targetMediaId = targetId cast to int
    await queryRunner.query(`
      UPDATE "Report" SET
        "target_type" = 'MEDIA',
        "target_media_id" = CAST(target_id AS int)
      WHERE report_type = 'MEDIA'
    `);

    // Make source NOT NULL now that all rows have been migrated
    await queryRunner.query(`ALTER TABLE "Report" ALTER COLUMN "source" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "Report" ALTER COLUMN "target_type" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "Report" ALTER COLUMN "target_media_id" SET NOT NULL`);

    // Make userId nullable (AUTO reports have no user)
    await queryRunner.query(`ALTER TABLE "Report" ALTER COLUMN "user_id" DROP NOT NULL`);

    // Drop old columns
    await queryRunner.query(`ALTER TABLE "Report" DROP COLUMN IF EXISTS "report_type"`);
    await queryRunner.query(`ALTER TABLE "Report" DROP COLUMN IF EXISTS "target_id"`);
    await queryRunner.query(`ALTER TABLE "Report" DROP COLUMN IF EXISTS "resolved_at"`);
    await queryRunner.query(`ALTER TABLE "Report" DROP COLUMN IF EXISTS "resolved_by_id"`);

    // Drop old indexes and create new ones
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_Report_reportType_targetId"`);
    await queryRunner.query(`CREATE INDEX "IDX_Report_source" ON "Report" ("source")`);
    await queryRunner.query(`CREATE INDEX "IDX_Report_targetType_targetMediaId" ON "Report" ("target_type", "target_media_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_Report_reviewCheckRunId" ON "Report" ("review_check_run_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop new indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_Report_source"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_Report_targetType_targetMediaId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_Report_reviewCheckRunId"`);

    // Re-add old columns to Report
    await queryRunner.query(`ALTER TABLE "Report" ADD COLUMN "report_type" report_type`);
    await queryRunner.query(`ALTER TABLE "Report" ADD COLUMN "target_id" varchar`);
    await queryRunner.query(`ALTER TABLE "Report" ADD COLUMN "resolved_at" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "Report" ADD COLUMN "resolved_by_id" int REFERENCES "User"("id") ON DELETE SET NULL`);

    // Migrate data back
    await queryRunner.query(`
      UPDATE "Report" SET
        "report_type" = CASE WHEN target_type = 'SEGMENT' THEN 'SEGMENT' ELSE 'MEDIA' END,
        "target_id" = CASE WHEN target_type = 'SEGMENT' THEN target_segment_uuid ELSE CAST(target_media_id AS varchar) END
    `);

    await queryRunner.query(`ALTER TABLE "Report" ALTER COLUMN "report_type" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "Report" ALTER COLUMN "target_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "Report" ALTER COLUMN "user_id" SET NOT NULL`);

    // Drop new columns
    await queryRunner.query(`ALTER TABLE "Report" DROP COLUMN IF EXISTS "source"`);
    await queryRunner.query(`ALTER TABLE "Report" DROP COLUMN IF EXISTS "target_type"`);
    await queryRunner.query(`ALTER TABLE "Report" DROP COLUMN IF EXISTS "target_media_id"`);
    await queryRunner.query(`ALTER TABLE "Report" DROP COLUMN IF EXISTS "target_episode_number"`);
    await queryRunner.query(`ALTER TABLE "Report" DROP COLUMN IF EXISTS "target_segment_uuid"`);
    await queryRunner.query(`ALTER TABLE "Report" DROP COLUMN IF EXISTS "review_check_run_id"`);
    await queryRunner.query(`ALTER TABLE "Report" DROP COLUMN IF EXISTS "data"`);

    // Re-create old index
    await queryRunner.query(`CREATE INDEX "IDX_Report_reportType_targetId" ON "Report" ("report_type", "target_id")`);

    // Drop new tables
    await queryRunner.query(`DROP TABLE IF EXISTS "ReviewAllowlist"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ReviewCheck"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ReviewCheckRun"`);

    // Drop new enum types
    await queryRunner.query(`DROP TYPE IF EXISTS report_source`);
    await queryRunner.query(`DROP TYPE IF EXISTS report_target_type`);
    await queryRunner.query(`DROP TYPE IF EXISTS review_check_target_type`);
  }
}
