import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the media audit system.
 *
 * The audit runner produced AUTO reports on a schedule, but it was never
 * actually run in production — moderation is moving to an external agent that
 * reads the same `Report` table and acts through the segment endpoints, so the
 * in-app runner has no remaining caller.
 *
 * `Report.audit_run_id` goes with it. The FK is the only thing tying a report to
 * a run; any AUTO rows that exist keep their `source` and `reason` and simply
 * lose the run they came from, which is the correct outcome once runs are gone.
 *
 * Two things are deliberately left behind:
 *
 *   - The `ReportReason` AUTO codes (`DB_ES_SYNC_ISSUES` and friends). Removing a
 *     Postgres enum value means rewriting the type and every column using it, and
 *     unused values cost nothing — the same call `SegmentStatus` already makes.
 *   - The `media_audit_target_type` type, which is owned by the enums migration
 *     (1706150400000) that created it. Dropping it here would leave that
 *     migration's own `down()` failing on a type that no longer exists.
 */
export class DropMediaAudits1786100000000 implements MigrationInterface {
  name = 'DropMediaAudits1786100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_Report_auditRunId"`);
    await queryRunner.query(`ALTER TABLE "Report" DROP COLUMN IF EXISTS "audit_run_id"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_MediaAuditRun_audit_name_created_at_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "MediaAuditRun"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "MediaAudit"`);
  }

  /**
   * Recreates the shape, not the data. The audit configs were seeded at boot by
   * an initializer that no longer exists, so a rollback leaves empty tables —
   * enough for the schema to match, not enough to run audits again. Restoring
   * that means reverting the application code too.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "MediaAuditRun" (
        "id" SERIAL PRIMARY KEY,
        "audit_name" varchar NOT NULL CHECK ("audit_name" <> ''),
        "category" varchar,
        "result_count" integer NOT NULL,
        "threshold_used" jsonb NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "MediaAudit" (
        "id" SERIAL PRIMARY KEY,
        "name" varchar NOT NULL UNIQUE CHECK ("name" <> ''),
        "label" varchar NOT NULL CHECK ("label" <> ''),
        "description" text NOT NULL CHECK ("description" <> ''),
        "target_type" media_audit_target_type NOT NULL,
        "threshold" jsonb NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_MediaAuditRun_audit_name_created_at_id"
      ON "MediaAuditRun" ("audit_name", "created_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      ALTER TABLE "Report"
      ADD COLUMN "audit_run_id" integer REFERENCES "MediaAuditRun"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`CREATE INDEX "IDX_Report_auditRunId" ON "Report" ("audit_run_id")`);
  }
}
