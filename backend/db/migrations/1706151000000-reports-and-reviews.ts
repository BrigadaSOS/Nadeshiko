import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ReportsAndReviews1706151000000 implements MigrationInterface {
  name = 'ReportsAndReviews1706151000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ===== REVIEW CHECK RUN =====
    await queryRunner.query(`
      CREATE TABLE "ReviewCheckRun" (
        "id" SERIAL PRIMARY KEY,
        "check_name" varchar NOT NULL,
        "category" varchar,
        "result_count" integer NOT NULL,
        "threshold_used" jsonb NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ
      )
    `);

    // ===== REVIEW CHECK =====
    await queryRunner.query(`
      CREATE TABLE "ReviewCheck" (
        "id" SERIAL PRIMARY KEY,
        "name" varchar NOT NULL UNIQUE,
        "label" varchar NOT NULL,
        "description" text NOT NULL,
        "target_type" review_check_target_type NOT NULL,
        "threshold" jsonb NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ
      )
    `);

    // ===== REVIEW ALLOWLIST =====
    await queryRunner.query(`
      CREATE TABLE "ReviewAllowlist" (
        "id" SERIAL PRIMARY KEY,
        "check_name" varchar NOT NULL,
        "media_id" integer NOT NULL,
        "episode_number" integer,
        "reason" varchar,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ,
        UNIQUE ("check_name", "media_id", "episode_number")
      )
    `);

    // ===== REPORT =====
    await queryRunner.query(`
      CREATE TABLE "Report" (
        "id" SERIAL PRIMARY KEY,
        "source" report_source NOT NULL,
        "target_type" report_target_type NOT NULL,
        "target_media_id" integer NOT NULL,
        "target_episode_number" integer,
        "target_segment_uuid" varchar,
        "reason" report_reason NOT NULL,
        "description" varchar(1000),
        "status" report_status NOT NULL DEFAULT 'PENDING',
        "admin_notes" varchar(1000),
        "data" jsonb,
        "review_check_run_id" integer REFERENCES "ReviewCheckRun"("id") ON DELETE SET NULL,
        "user_id" integer REFERENCES "User"("id") ON DELETE CASCADE,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_report_user_id" ON "Report" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_report_status" ON "Report" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_Report_source" ON "Report" ("source")`);
    await queryRunner.query(`
      CREATE INDEX "IDX_Report_targetType_targetMediaId" ON "Report" ("target_type", "target_media_id")
    `);
    await queryRunner.query(`CREATE INDEX "IDX_Report_reviewCheckRunId" ON "Report" ("review_check_run_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "Report"`);
    await queryRunner.query(`DROP TABLE "ReviewAllowlist"`);
    await queryRunner.query(`DROP TABLE "ReviewCheck"`);
    await queryRunner.query(`DROP TABLE "ReviewCheckRun"`);
  }
}
