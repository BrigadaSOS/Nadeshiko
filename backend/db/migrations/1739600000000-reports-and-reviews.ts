import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReportsAndReviews1739600000000 implements MigrationInterface {
  name = 'ReportsAndReviews1739600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ===== ENUM TYPES =====
    await queryRunner.query(
      `CREATE TYPE report_status AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'RESOLVED', 'CONCERN', 'IGNORED')`,
    );
    await queryRunner.query(`
      CREATE TYPE report_reason AS ENUM (
        'WRONG_TRANSLATION', 'WRONG_TIMING', 'WRONG_AUDIO', 'NSFW_NOT_TAGGED', 'DUPLICATE_SEGMENT',
        'WRONG_METADATA', 'MISSING_EPISODES', 'WRONG_COVER_IMAGE',
        'INAPPROPRIATE_CONTENT', 'OTHER',
        'LOW_SEGMENT_MEDIA', 'EMPTY_EPISODES', 'MISSING_EPISODES_AUTO', 'BAD_SEGMENT_RATIO',
        'MEDIA_WITH_NO_EPISODES', 'MISSING_TRANSLATIONS', 'DB_ES_SYNC_ISSUES', 'HIGH_REPORT_DENSITY'
      )
    `);
    await queryRunner.query(`CREATE TYPE report_source AS ENUM ('USER', 'AUTO')`);
    await queryRunner.query(`CREATE TYPE report_target_type AS ENUM ('SEGMENT', 'EPISODE', 'MEDIA')`);
    await queryRunner.query(`CREATE TYPE review_check_target_type AS ENUM ('MEDIA', 'EPISODE')`);

    // ===== REVIEW SYSTEM TABLES (before Report, which references ReviewCheckRun) =====
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

    // ===== REPORT TABLE =====
    await queryRunner.query(`
      CREATE TABLE "Report" (
        "id" SERIAL PRIMARY KEY,
        "source" report_source NOT NULL,
        "target_type" report_target_type NOT NULL,
        "target_media_id" int NOT NULL,
        "target_episode_number" int,
        "target_segment_uuid" varchar,
        "reason" report_reason NOT NULL,
        "description" varchar(1000),
        "status" report_status NOT NULL DEFAULT 'PENDING',
        "admin_notes" varchar(1000),
        "data" jsonb,
        "review_check_run_id" int REFERENCES "ReviewCheckRun"("id") ON DELETE SET NULL,
        "user_id" int REFERENCES "User"("id") ON DELETE CASCADE,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_report_user_id" ON "Report" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_report_status" ON "Report" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_Report_source" ON "Report" ("source")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_Report_targetType_targetMediaId" ON "Report" ("target_type", "target_media_id")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_Report_reviewCheckRunId" ON "Report" ("review_check_run_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "Report"`);
    await queryRunner.query(`DROP TABLE "ReviewAllowlist"`);
    await queryRunner.query(`DROP TABLE "ReviewCheck"`);
    await queryRunner.query(`DROP TABLE "ReviewCheckRun"`);

    await queryRunner.query(`DROP TYPE review_check_target_type`);
    await queryRunner.query(`DROP TYPE report_target_type`);
    await queryRunner.query(`DROP TYPE report_source`);
    await queryRunner.query(`DROP TYPE report_reason`);
    await queryRunner.query(`DROP TYPE report_status`);
  }
}
